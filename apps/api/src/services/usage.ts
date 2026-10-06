/**
 * Per-tenant 30-day outbound-message usage helpers (Phase 4a + 4c).
 *
 * Phase 4c moved the quota cycle from "calendar month" to "30 days anchored
 * to each tenant's signup." A tenant who signs up on May 12 gets 5,000 msgs
 * for May 12–Jun 10, fresh 5,000 for Jun 11–Jul 10, and so on — the cycle
 * never snaps back to the calendar 1st. This stops mid-month subscribers
 * from accidentally getting double quota in their first 30 days.
 *
 * - `currentCycleKey(tenant)`: the YYYY-MM-DD identifier of the tenant's
 *   current 30-day window (used as the `month` column on TenantUsage so the
 *   unique key `[tenantId, month]` doesn't need a schema change).
 * - `getQuotaState`: reads the current cycle's TenantUsage row.
 * - `tryReserveOutbound`: atomic upsert + increment under quota cap.
 * - `checkOutboundQuota`: convenience that resolves plan + evaluates.
 *
 * All helpers are safe to call from the BullMQ worker, the bot, and
 * authenticated HTTP routes — the Prisma `$extends` tenant guard skips when
 * the call originates from the worker (no tenant context) and is satisfied
 * by the explicit `tenantId` filter otherwise.
 */

import type { PrismaClient, SubscriptionStatus } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { effectiveMessageQuota, getPlan, type Plan } from './plans.js';
import { resolveOutboundPause } from './platform-switches.js';
import { scoped } from '../lib/logger.js';

const log = scoped('usage');

// The worker and the API use slightly different Prisma client types (raw vs
// `$extends`-wrapped). Both expose the same methods we need here, so accept
// either.
export type AnyPrismaClient = PrismaClient | ExtendedPrismaClient;

// Phase 4b — grace period between PAST_DUE and auto-downgrade to Free.
const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Phase 4c — quota cycle length in ms (30 days).
const CYCLE_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Tenant fields the cycle helpers need. Accepting a plain object keeps these
 * helpers easy to unit-test without a real Prisma row. Both fields are
 * tolerated as nullable to defend against partial mocks / legacy rows.
 */
export interface TenantCycleAnchor {
    quotaCycleStart: Date | null | undefined;
    createdAt: Date | null | undefined;
}

interface QuotaTenantRow extends TenantCycleAnchor {
    monthlyMessageQuotaOverride?: number | null;
}

/**
 * The start of the tenant's CURRENT 30-day quota cycle.
 *
 * Anchor = `quotaCycleStart` (set at signup, never re-set) with `createdAt`
 * as a fallback for tenants that predate the column. If both are missing
 * (test mocks, edge cases), fall back to `now` so callers never crash. The
 * current cycle is the most recent `anchor + N*30days` window containing
 * `now`.
 */
export function currentCycleStart(
    tenant: TenantCycleAnchor,
    now: Date = new Date(),
): Date {
    const anchor = tenant.quotaCycleStart ?? tenant.createdAt ?? now;
    const elapsed = now.getTime() - anchor.getTime();
    if (elapsed < CYCLE_LENGTH_MS) return anchor;
    const periodsElapsed = Math.floor(elapsed / CYCLE_LENGTH_MS);
    return new Date(anchor.getTime() + periodsElapsed * CYCLE_LENGTH_MS);
}

/**
 * The end of the tenant's current 30-day quota cycle (= next reset date).
 */
export function currentCycleEnd(
    tenant: TenantCycleAnchor,
    now: Date = new Date(),
): Date {
    return new Date(currentCycleStart(tenant, now).getTime() + CYCLE_LENGTH_MS);
}

/**
 * Stable string identifier for the tenant's current cycle — stored in the
 * `TenantUsage.month` column (kept the column name to avoid a rename
 * migration; semantically it's now a cycle key, e.g. "2026-05-12").
 */
export function currentCycleKey(
    tenant: TenantCycleAnchor,
    now: Date = new Date(),
): string {
    return currentCycleStart(tenant, now).toISOString().slice(0, 10);
}

/**
 * @deprecated — kept for backward compat with one external caller that
 * doesn't have tenant context. Returns the calendar-month key as before.
 * Prefer `currentCycleKey(tenant)` for any quota-bearing operation.
 */
export function currentMonthKey(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface QuotaState {
    /** False when the quota is spent OR sending is paused (see `paused`). */
    ok: boolean;
    /** Present (true) only when an emergency outbound pause refused the send. */
    paused?: boolean;
    pauseReason?: string;
    used: number;
    limit: number;
    planId: string;
    /** Start of the current 30-day cycle (the tenant's personal anchor). */
    cycleStart: Date;
    /** Date the quota next refreshes (start + 30 days). */
    cycleEnd: Date;
}

async function loadCycleAnchor(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<QuotaTenantRow | null> {
    return prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { quotaCycleStart: true, createdAt: true, monthlyMessageQuotaOverride: true },
    });
}

export async function getQuotaState(
    prisma: AnyPrismaClient,
    tenantId: string,
    planId: string | null | undefined,
): Promise<QuotaState> {
    const plan = getPlan(planId);
    const anchor = await loadCycleAnchor(prisma, tenantId);
    // Fallback: if the tenant somehow doesn't exist, return an empty cycle
    // anchored at now so callers don't crash. The quota check still works
    // (used=0 < limit).
    const safeAnchor: TenantCycleAnchor = anchor ?? { quotaCycleStart: null, createdAt: new Date() };
    const cycleStart = currentCycleStart(safeAnchor);
    const cycleEnd = currentCycleEnd(safeAnchor);
    const row = await prisma.tenantUsage.findUnique({
        where: { tenantId_month: { tenantId, month: currentCycleKey(safeAnchor) } },
        select: { messageCount: true },
    });
    const used = row?.messageCount ?? 0;
    const limit = effectiveMessageQuota(plan, anchor?.monthlyMessageQuotaOverride);
    return {
        ok: used < limit,
        used,
        limit,
        planId: plan.id,
        cycleStart,
        cycleEnd,
    };
}

/**
 * `reason` tells a quota refusal from an emergency pause (A5), so a caller can
 * stay silent or say something different instead of "quota exhausted".
 */
export type ReserveOutcome =
    | { ok: true; used: number; limit: number; planId: string }
    | { ok: false; used: number; limit: number; planId: string; reason: 'quota' }
    | { ok: false; used: number; limit: number; planId: string; reason: 'paused'; pauseReason?: string };

// A pause is logged once per tenant until it is lifted: a paused tenant under
// load would otherwise write a line (and tempt a caller into an alert) per message.
const pauseLogged = new Set<string>();

/** True the first time a pause is seen for this tenant (and records it). */
export function notePauseLogged(tenantId: string): boolean {
    if (pauseLogged.has(tenantId)) return false;
    pauseLogged.add(tenantId);
    return true;
}

function notePauseLifted(tenantId: string): void {
    pauseLogged.delete(tenantId);
}

/**
 * Atomically reserve one outbound message slot in a single SQL statement.
 *
 * - Resolves the tenant's effective plan first (so expired trials / lapsed
 *   PAST_DUE are demoted before quota check).
 * - Uses `updateMany WHERE messageCount < limit` so two parallel callers
 *   cannot both reserve when only one slot remains.
 * - Returns `ok: true` with the post-increment count when the slot was
 *   secured, or `ok: false` when the quota is full.
 *
 * Callers that successfully reserve but then fail to send (Meta 5xx, network
 * error) should call `rollbackOutboundReservation` so transient failures
 * don't burn quota.
 *
 * Use this in place of `checkOutboundQuota` + `incrementMessageUsage` —
 * those two together are not safe under concurrency.
 */
export async function tryReserveOutbound(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<ReserveOutcome> {
    const resolved = await evaluateSubscription(prisma, tenantId);
    const limit = effectiveMessageQuota(resolved.plan, resolved.quotaOverride);
    const planId = resolved.plan.id;
    const month = currentCycleKey(resolved.cycleAnchor);

    // Emergency pause: refuse BEFORE touching the counter, so a paused tenant's
    // usage neither grows nor needs a rollback.
    const pause = await outboundPauseFor(prisma, tenantId, resolved);
    if (pause.paused) {
        return { ok: false, used: 0, limit, planId, reason: 'paused', pauseReason: pause.reason };
    }

    // Ensure the row exists so updateMany can hit it. Create with count=0
    // (not 1) so the atomic increment below is the canonical counter.
    await prisma.tenantUsage.upsert({
        where: { tenantId_month: { tenantId, month } },
        create: { tenantId, month, messageCount: 0 },
        // Must NOT be empty: Prisma only emits an atomic INSERT ... ON
        // CONFLICT for a non-empty update; with `{}` two first reservations
        // of a cycle race and one throws P2002 (proven on a real database).
        // A zero increment changes nothing.
        update: { messageCount: { increment: 0 } },
    });

    // updateMany's WHERE doesn't accept the composite-key shortcut
    // (`tenantId_month`) that findUnique/update do — use individual fields.
    const claimed = await prisma.tenantUsage.updateMany({
        where: {
            tenantId,
            month,
            messageCount: { lt: limit },
        },
        data: { messageCount: { increment: 1 } },
    });

    const row = await prisma.tenantUsage.findUnique({
        where: { tenantId_month: { tenantId, month } },
        select: { messageCount: true },
    });
    const used = row?.messageCount ?? 0;

    if (claimed.count === 1) {
        return { ok: true, used, limit, planId };
    }
    return { ok: false, used, limit, planId, reason: 'quota' };
}

async function outboundPauseFor(prisma: AnyPrismaClient, tenantId: string, resolved: ResolvedPlan) {
    const pause = await resolveOutboundPause(prisma, {
        outboundPausedAt: resolved.outboundPausedAt,
        pauseReason: resolved.pauseReason,
    });
    if (pause.paused) {
        if (notePauseLogged(tenantId)) {
            log.warn({ tenantId, reason: pause.reason }, 'outbound messages are paused; sends are being refused');
        }
    } else {
        notePauseLifted(tenantId);
    }
    return pause;
}

/**
 * Decrement the counter after a failed send so transient failures don't
 * permanently burn quota. Use as the cleanup step when `tryReserveOutbound`
 * succeeded but the actual Meta call failed.
 *
 * Guarded with `messageCount > 0` so concurrent rollbacks never go negative.
 */
export async function rollbackOutboundReservation(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<void> {
    const anchor = await loadCycleAnchor(prisma, tenantId);
    if (!anchor) return;
    const month = currentCycleKey(anchor);
    await prisma.tenantUsage.updateMany({
        where: { tenantId, month, messageCount: { gt: 0 } },
        data: { messageCount: { decrement: 1 } },
    });
}

/**
 * @deprecated use `tryReserveOutbound` — the check-then-increment pair is
 * not safe under concurrency. Kept for tests that still depend on it.
 *
 * Atomically count one outbound message against the current month. Returns
 * the post-increment value. Call AFTER a successful send so transient send
 * failures don't burn quota.
 */
export async function incrementMessageUsage(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<number> {
    const anchor = await loadCycleAnchor(prisma, tenantId);
    if (!anchor) return 0;
    const month = currentCycleKey(anchor);
    const row = await prisma.tenantUsage.upsert({
        where: { tenantId_month: { tenantId, month } },
        create: { tenantId, month, messageCount: 1 },
        update: { messageCount: { increment: 1 } },
        select: { messageCount: true },
    });
    return row.messageCount;
}

/**
 * Platform-SMS fallback usage lives on the SAME TenantUsage row as message
 * usage (one row per tenant per cycle). It used to be bucketed by calendar
 * month, which created a second row per tenant and skewed admin numbers.
 * Old YYYY-MM rows are left in place; they are simply never read again.
 */
export async function incrementPlatformSmsUsage(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<void> {
    const anchor = await loadCycleAnchor(prisma, tenantId);
    if (!anchor) return;
    const month = currentCycleKey(anchor);
    await prisma.tenantUsage.upsert({
        where: { tenantId_month: { tenantId, month } },
        create: { tenantId, month, platformSmsCount: 1 },
        update: { platformSmsCount: { increment: 1 } },
    });
}

export async function getPlatformSmsCount(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<number> {
    const anchor = await loadCycleAnchor(prisma, tenantId);
    if (!anchor) return 0;
    const row = await prisma.tenantUsage.findUnique({
        where: { tenantId_month: { tenantId, month: currentCycleKey(anchor) } },
        select: { platformSmsCount: true },
    });
    return row?.platformSmsCount ?? 0;
}

/**
 * Convenience helper used by every outbound send site: resolve the tenant's
 * effective plan (running the subscription evaluator first so an expired
 * trial or lapsed PAST_DUE has been demoted before we count quota) and then
 * evaluate the monthly message quota.
 */
export async function checkOutboundQuota(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<QuotaState> {
    const resolved = await evaluateSubscription(prisma, tenantId);
    const state = await getQuotaState(prisma, tenantId, resolved.plan.id);
    const pause = await outboundPauseFor(prisma, tenantId, resolved);
    if (pause.paused) return { ...state, ok: false, paused: true, pauseReason: pause.reason };
    return state;
}

export interface ResolvedPlan {
    plan: Plan;
    status: SubscriptionStatus | null;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    /** Anchor for the per-tenant 30-day quota cycle (Phase 4c). */
    cycleAnchor: TenantCycleAnchor;
    /** Per-tenant replacement for plan.monthlyMessageQuota; null = plan default. */
    quotaOverride: number | null;
    /** Emergency outbound pause (A5), straight from the tenant row. */
    outboundPausedAt: Date | null;
    pauseReason: string | null;
}

/**
 * Read tenant subscription state and, if a deadline has lapsed, demote to
 * Free + CANCELLED. Returns the post-evaluation plan AND the quota cycle
 * anchor so callers don't need a second query.
 *
 * Lazy: only writes when state actually changes. The two transitions are:
 *   - TRIALING + trialEndsAt < now            → Free / CANCELLED
 *   - PAST_DUE + currentPeriodEnd + 7d < now  → Free / CANCELLED
 *
 * Returns a safe default (Free / null) when the tenant is missing.
 */
export async function evaluateSubscription(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<ResolvedPlan> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            planId: true,
            subscriptionStatus: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            quotaCycleStart: true,
            createdAt: true,
            monthlyMessageQuotaOverride: true,
            outboundPausedAt: true,
            pauseReason: true,
        },
    });
    if (!tenant) {
        return {
            plan: getPlan('free'),
            status: null,
            trialEndsAt: null,
            currentPeriodEnd: null,
            cycleAnchor: { quotaCycleStart: null, createdAt: new Date() },
            quotaOverride: null,
            outboundPausedAt: null,
            pauseReason: null,
        };
    }

    const cycleAnchor: TenantCycleAnchor = {
        quotaCycleStart: tenant.quotaCycleStart ?? null,
        createdAt: tenant.createdAt ?? new Date(),
    };

    const quotaOverride = tenant.monthlyMessageQuotaOverride ?? null;
    const outboundPausedAt = tenant.outboundPausedAt ?? null;
    const pauseReason = tenant.pauseReason ?? null;
    const now = Date.now();
    const status = tenant.subscriptionStatus;
    const trialExpired =
        status === 'TRIALING' &&
        tenant.trialEndsAt &&
        tenant.trialEndsAt.getTime() < now;
    const pastDueLapsed =
        status === 'PAST_DUE' &&
        tenant.currentPeriodEnd &&
        tenant.currentPeriodEnd.getTime() + PAST_DUE_GRACE_MS < now;

    if (trialExpired || pastDueLapsed) {
        await prisma.tenant.update({
            where: { id: tenantId },
            data: {
                planId: 'free',
                subscriptionStatus: 'CANCELLED',
            },
        });
        return {
            plan: getPlan('free'),
            status: 'CANCELLED',
            trialEndsAt: tenant.trialEndsAt,
            currentPeriodEnd: tenant.currentPeriodEnd,
            cycleAnchor,
            quotaOverride,
            outboundPausedAt,
            pauseReason,
        };
    }

    return {
        plan: getPlan(tenant.planId),
        status,
        trialEndsAt: tenant.trialEndsAt,
        currentPeriodEnd: tenant.currentPeriodEnd,
        cycleAnchor,
        quotaOverride,
        outboundPausedAt,
        pauseReason,
    };
}
