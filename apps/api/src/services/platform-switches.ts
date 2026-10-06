/**
 * Emergency switches (A5): pause a tenant's outbound messages or payouts, or
 * pause payouts/outbound for the whole platform.
 *
 * A switch is ON when either
 *  - the tenant's timestamp is set (Tenant.outboundPausedAt / payoutsPausedAt), or
 *  - the platform-wide PlatformSetting key is `{ paused: true }`.
 *
 * Contract used by the money agent and the send paths:
 *   isPayoutsPaused(prisma, tenantId)  -> { paused, reason? }
 *   isOutboundPaused(prisma, tenantId) -> { paused, reason? }
 *
 * Tenant flags are read fresh from the row (callers already load it, and a
 * pause must bite immediately). Only the PLATFORM keys are cached, briefly
 * (SWITCH_CACHE_MS), because they are read on every message reservation. The
 * cache is per Prisma client and is invalidated by this process's setters, so
 * the worst case elsewhere is SWITCH_CACHE_MS of delay.
 */
import type { AnyPrismaClient } from './usage.js';
import { scoped } from '../lib/logger.js';

const log = scoped('platform-switches');

export const PAYOUTS_PAUSED_KEY = 'payouts.paused';
export const OUTBOUND_PAUSED_KEY = 'outbound.paused';
export const REQUIRE_2FA_KEY = 'admin.require2fa';

/** Upper bound on how long a platform setting may be served from memory. */
export const SWITCH_CACHE_MS = 15_000;

export interface SwitchState {
    paused: boolean;
    reason?: string;
}

export type SwitchKind = 'outbound' | 'payouts';

interface CacheEntry { value: unknown; at: number }
let caches = new WeakMap<object, Map<string, CacheEntry>>();

/** Drop every cached platform setting (tests, and after any local write). */
export function clearSwitchCache(): void {
    caches = new WeakMap();
}

function cacheFor(prisma: object): Map<string, CacheEntry> {
    let m = caches.get(prisma);
    if (!m) { m = new Map(); caches.set(prisma, m); }
    return m;
}

/** Read a PlatformSetting value (null when absent), cached for SWITCH_CACHE_MS. */
export async function getPlatformSetting(
    prisma: AnyPrismaClient,
    key: string,
    now: number = Date.now(),
): Promise<unknown> {
    const cache = cacheFor(prisma);
    const hit = cache.get(key);
    if (hit && now - hit.at < SWITCH_CACHE_MS) return hit.value;
    const row = await prisma.platformSetting.findUnique({ where: { key }, select: { value: true } });
    const value = row?.value ?? null;
    cache.set(key, { value, at: now });
    return value;
}

export async function setPlatformSetting(
    prisma: AnyPrismaClient,
    key: string,
    value: Record<string, unknown>,
    updatedBy: string | null,
): Promise<void> {
    await prisma.platformSetting.upsert({
        where: { key },
        create: { key, value: value as never, updatedBy },
        update: { value: value as never, updatedBy },
    });
    cacheFor(prisma).delete(key);
}

function platformState(value: unknown): SwitchState {
    if (!value || typeof value !== 'object') return { paused: false };
    const v = value as { paused?: unknown; reason?: unknown };
    if (v.paused !== true) return { paused: false };
    return { paused: true, reason: typeof v.reason === 'string' ? v.reason : 'Paused platform-wide' };
}

interface TenantPauseRow {
    outboundPausedAt?: Date | null;
    payoutsPausedAt?: Date | null;
    pauseReason?: string | null;
}

/** Combine a tenant row with the platform key. Pure, so callers that already hold the row avoid a query. */
export function combineSwitch(
    kind: SwitchKind,
    tenant: TenantPauseRow | null | undefined,
    platformValue: unknown,
): SwitchState {
    const platform = platformState(platformValue);
    if (platform.paused) return platform;
    const at = kind === 'outbound' ? tenant?.outboundPausedAt : tenant?.payoutsPausedAt;
    if (at) return { paused: true, reason: tenant?.pauseReason ?? 'Paused for this organisation' };
    return { paused: false };
}

const PLATFORM_KEY: Record<SwitchKind, string> = {
    outbound: OUTBOUND_PAUSED_KEY,
    payouts: PAYOUTS_PAUSED_KEY,
};

/** Resolve an outbound pause when the caller already loaded the tenant row. */
export async function resolveOutboundPause(
    prisma: AnyPrismaClient,
    tenant: TenantPauseRow | null | undefined,
): Promise<SwitchState> {
    if (tenant?.outboundPausedAt) return combineSwitch('outbound', tenant, null);
    try {
        return combineSwitch('outbound', tenant, await getPlatformSetting(prisma, OUTBOUND_PAUSED_KEY));
    } catch (err) {
        // Messaging must not go down because a settings read failed.
        log.error({ err }, 'could not read the platform outbound switch; treating as not paused');
        return { paused: false };
    }
}

async function loadTenantPause(prisma: AnyPrismaClient, tenantId: string): Promise<TenantPauseRow | null> {
    return prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { outboundPausedAt: true, payoutsPausedAt: true, pauseReason: true },
    });
}

export async function isOutboundPaused(prisma: AnyPrismaClient, tenantId: string): Promise<SwitchState> {
    return resolveOutboundPause(prisma, await loadTenantPause(prisma, tenantId));
}

/**
 * Money path: a failed read PROPAGATES. Paying out while unsure the platform is
 * paused is the wrong way to fail.
 */
export async function isPayoutsPaused(prisma: AnyPrismaClient, tenantId: string): Promise<SwitchState> {
    const [tenant, platform] = await Promise.all([
        loadTenantPause(prisma, tenantId),
        getPlatformSetting(prisma, PAYOUTS_PAUSED_KEY),
    ]);
    return combineSwitch('payouts', tenant, platform);
}

// ---------------------------------------------------------------
// Setters (used by the admin routes)
// ---------------------------------------------------------------

export class SwitchError extends Error {}

function cleanReason(reason: string | undefined, paused: boolean): string | null {
    const r = (reason ?? '').trim();
    if (paused && r.length < 3) throw new SwitchError('A reason is required to pause');
    return paused ? r.slice(0, 300) : null;
}

/**
 * Pause/resume one switch for one tenant. `pauseReason` is shared by both
 * switches (last pause wins); resuming clears it only when nothing is left
 * paused. Returns false when the tenant does not exist.
 */
export async function setTenantSwitch(
    prisma: AnyPrismaClient,
    tenantId: string,
    kind: SwitchKind,
    paused: boolean,
    reason?: string,
    now: Date = new Date(),
): Promise<boolean> {
    const clean = cleanReason(reason, paused);
    const current = await loadTenantPause(prisma, tenantId);
    if (!current) return false;
    const field = kind === 'outbound' ? 'outboundPausedAt' : 'payoutsPausedAt';
    const other = kind === 'outbound' ? current.payoutsPausedAt : current.outboundPausedAt;
    const data: Record<string, unknown> = { [field]: paused ? (current[field] ?? now) : null };
    if (paused) data.pauseReason = clean;
    else if (!other) data.pauseReason = null;
    await prisma.tenant.update({ where: { id: tenantId }, data: data as never });
    return true;
}

export async function setPlatformSwitch(
    prisma: AnyPrismaClient,
    kind: SwitchKind,
    paused: boolean,
    reason: string | undefined,
    adminId: string | null,
    now: Date = new Date(),
): Promise<void> {
    const clean = cleanReason(reason, paused);
    await setPlatformSetting(
        prisma,
        PLATFORM_KEY[kind],
        paused ? { paused: true, reason: clean, since: now.toISOString() } : { paused: false },
        adminId,
    );
}

export async function getPlatformSwitches(prisma: AnyPrismaClient): Promise<Record<SwitchKind, SwitchState>> {
    const [outbound, payouts] = await Promise.all([
        getPlatformSetting(prisma, OUTBOUND_PAUSED_KEY),
        getPlatformSetting(prisma, PAYOUTS_PAUSED_KEY),
    ]);
    return { outbound: platformState(outbound), payouts: platformState(payouts) };
}
