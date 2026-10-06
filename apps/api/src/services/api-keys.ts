/**
 * Public API keys (D2).
 *
 * FORMAT  bk_live_<prefix>_<secret>
 *   prefix  10 base62 chars, public: it is the lookup handle (ApiKey.prefix is
 *           unique) and what the dashboard shows. Never a credential.
 *   secret  48 base62 chars (~285 bits of CSPRNG output).
 *
 * STORAGE Only sha256(secret) is stored. A salted/slow hash (bcrypt, argon2)
 * is for low-entropy human passwords; this secret is 285 random bits, so a
 * brute force is infeasible even against a leaked fast hash, and a fast hash
 * keeps per-request verification cheap. No server pepper exists in config and
 * adding one would make every key unverifiable if it were ever rotated, so none
 * is used. The full key is returned exactly once, at creation.
 *
 * VERIFY  The prefix selects one row; the hash comparison uses
 * timingSafeEqual. An unknown prefix still performs a comparison against a
 * dummy hash so "no such key" and "wrong secret" cost the same.
 *
 * ROTATION  rotateApiKey issues a replacement (same name, same scopes) and
 * gives the old key an expiresAt = now + grace (0 = revoke now). Until then
 * both keys work, so a client can deploy the new key without downtime. An
 * expired key is refused exactly like a revoked one. Keys in grace do not count
 * against MAX_ACTIVE_KEYS_PER_TENANT (they are on their way out), but every key
 * that still works counts against MAX_VALID_KEYS_PER_TENANT, so repeated
 * rotation with long grace periods cannot pile up working keys.
 */

import crypto from 'node:crypto';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { raiseAlert } from './alerts.js';

type PrismaLike = ExtendedPrismaClient | any;

export const API_KEY_SCOPES = [
    'messages:write',
    'conversations:read',
    'conversations:write',
    'customers:read',
    'customers:write',
    'payments:write',
    // RIDES pack (TURBO app): balances / passes / history, and booking a package ride.
    'rides:read',
    'rides:write',
    // No 'events:read': nothing in the API reads events with a key (webhooks are
    // pushed, and the catalogue is public documentation), so a scope that grants
    // nothing would only mislead. Add it back together with the first route that checks it.
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const MAX_ACTIVE_KEYS_PER_TENANT = 20;
/** Active keys plus keys still inside a rotation grace period. */
export const MAX_VALID_KEYS_PER_TENANT = MAX_ACTIVE_KEYS_PER_TENANT * 2;
export const MAX_KEY_NAME_LENGTH = 60;
export const MAX_ROTATION_GRACE_HOURS = 168;
export const DEFAULT_ROTATION_GRACE_HOURS = 24;
/** lastUsedAt is advisory; writing it on every request would turn reads into writes. At most once a minute per key. */
export const LAST_USED_THROTTLE_MS = 60 * 1000;
const HOUR_MS = 3600 * 1000;

const KEY_PREFIX_LENGTH = 10;
const SECRET_LENGTH = 48;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_PATTERN = /^bk_live_([A-Za-z0-9]{10})_([A-Za-z0-9]{43,64})$/;
const MAX_RAW_KEY_LENGTH = 128;
const PREFIX_RETRIES = 3;

export type ApiKeyErrorCode = 'invalid_scopes' | 'invalid_name' | 'key_limit_reached' | 'invalid_grace' | 'not_found' | 'not_active';

export class ApiKeyError extends Error {
    constructor(
        public readonly code: ApiKeyErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ApiKeyError';
    }
}

/** Uniform base62 (rejection sampling: 248 = 62 * 4, so no modulo bias). */
function randomBase62(length: number): string {
    let out = '';
    while (out.length < length) {
        for (const byte of crypto.randomBytes(length * 2)) {
            if (byte < 248) out += BASE62[byte % 62];
            if (out.length === length) break;
        }
    }
    return out;
}

export function generateApiKey(): { key: string; prefix: string; secret: string } {
    const prefix = randomBase62(KEY_PREFIX_LENGTH);
    const secret = randomBase62(SECRET_LENGTH);
    return { key: `bk_live_${prefix}_${secret}`, prefix, secret };
}

export function parseApiKey(raw: unknown): { prefix: string; secret: string } | null {
    if (typeof raw !== 'string' || raw.length > MAX_RAW_KEY_LENGTH) return null;
    const m = KEY_PATTERN.exec(raw);
    return m ? { prefix: m[1], secret: m[2] } : null;
}

export function hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function verifySecret(secret: string, storedHash: string): boolean {
    if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
    const a = Buffer.from(hashSecret(secret), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
    return required.every((s) => granted.includes(s));
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
    return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------

export type ApiKeyStatus = 'active' | 'expiring' | 'expired' | 'revoked';

/** active: works, no end date. expiring: works until expiresAt (rotation grace). expired/revoked: refused. */
export function apiKeyStatus(row: { revokedAt?: Date | null; expiresAt?: Date | null }, now: Date = new Date()): ApiKeyStatus {
    if (row.revokedAt) return 'revoked';
    if (row.expiresAt) return row.expiresAt.getTime() > now.getTime() ? 'expiring' : 'expired';
    return 'active';
}

export interface ApiKeyView {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date | null;
    rotatedFromId: string | null;
    createdAt: Date;
    status: ApiKeyStatus;
}

const VIEW_SELECT = {
    id: true,
    name: true,
    prefix: true,
    scopes: true,
    lastUsedAt: true,
    revokedAt: true,
    expiresAt: true,
    rotatedFromId: true,
    createdAt: true,
} as const;

type ViewRow = Omit<ApiKeyView, 'status' | 'expiresAt' | 'rotatedFromId'> & {
    expiresAt?: Date | null;
    rotatedFromId?: string | null;
};

function toView(row: ViewRow, now: Date = new Date()): ApiKeyView {
    return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        lastUsedAt: row.lastUsedAt ?? null,
        revokedAt: row.revokedAt ?? null,
        expiresAt: row.expiresAt ?? null,
        rotatedFromId: row.rotatedFromId ?? null,
        createdAt: row.createdAt,
        status: apiKeyStatus(row, now),
    };
}

/** Keys that count against MAX_ACTIVE_KEYS_PER_TENANT: not revoked and not on their way out. */
const activeKeyWhere = (tenantId: string) => ({ tenantId, revokedAt: null, expiresAt: null });

/** Keys that still authenticate right now (active or inside a grace period). */
const workingKeyWhere = (tenantId: string, now: Date) => ({
    tenantId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

export interface CreateApiKeyInput {
    tenantId: string;
    name: string;
    scopes: string[];
    createdBy?: string | null;
}

export async function createApiKey(
    prisma: PrismaLike,
    input: CreateApiKeyInput,
): Promise<{ key: string; apiKey: ApiKeyView }> {
    const name = (input.name ?? '').trim();
    if (!name || name.length > MAX_KEY_NAME_LENGTH) {
        throw new ApiKeyError('invalid_name', `Name must be 1-${MAX_KEY_NAME_LENGTH} characters`);
    }
    const scopes = [...new Set(input.scopes ?? [])];
    if (scopes.length === 0 || !scopes.every(isApiKeyScope)) {
        throw new ApiKeyError('invalid_scopes', 'Choose at least one valid scope');
    }

    // Soft limit: two simultaneous creates by the same owner could overshoot by
    // one. Acceptable for a cap whose purpose is hygiene, not a security line.
    const active = await prisma.apiKey.count({ where: activeKeyWhere(input.tenantId) });
    if (active >= MAX_ACTIVE_KEYS_PER_TENANT) {
        throw new ApiKeyError('key_limit_reached', `At most ${MAX_ACTIVE_KEYS_PER_TENANT} active API keys per organisation`);
    }

    return insertKey(prisma, { tenantId: input.tenantId, name, scopes, createdBy: input.createdBy ?? null }, PREFIX_RETRIES);
}

interface InsertKeyData {
    tenantId: string;
    name: string;
    scopes: string[];
    createdBy: string | null;
    rotatedFromId?: string;
}

/**
 * Generate and store one key. `retries` re-rolls on a prefix collision; inside
 * an interactive transaction pass 0 (Postgres aborts the transaction on the
 * first error, so a retry there could never succeed).
 */
async function insertKey(prisma: PrismaLike, data: InsertKeyData, retries: number): Promise<{ key: string; apiKey: ApiKeyView }> {
    for (let attempt = 0; ; attempt++) {
        const { key, prefix, secret } = generateApiKey();
        try {
            const row = await prisma.apiKey.create({
                data: {
                    tenantId: data.tenantId,
                    name: data.name,
                    prefix,
                    secretHash: hashSecret(secret),
                    scopes: data.scopes,
                    createdBy: data.createdBy,
                    ...(data.rotatedFromId ? { rotatedFromId: data.rotatedFromId } : {}),
                },
            });
            return { key, apiKey: toView(row) };
        } catch (err) {
            if ((err as { code?: string }).code === 'P2002' && attempt < retries) continue;
            throw err;
        }
    }
}

export async function listApiKeys(prisma: PrismaLike, tenantId: string): Promise<ApiKeyView[]> {
    const rows: ViewRow[] = await prisma.apiKey.findMany({
        where: { tenantId },
        select: VIEW_SELECT,
        orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return rows.map((r) => toView(r, now));
}

export interface AdminApiKeyView extends ApiKeyView {
    createdBy: string | null;
}

/** Platform-admin listing: the dashboard view plus who created each key. Never the hash. */
export async function listApiKeysForAdmin(prisma: PrismaLike, tenantId: string, take = 200): Promise<AdminApiKeyView[]> {
    const rows: Array<ViewRow & { createdBy: string | null }> = await prisma.apiKey.findMany({
        where: { tenantId },
        select: { ...VIEW_SELECT, createdBy: true },
        orderBy: { createdAt: 'desc' },
        take,
    });
    const now = new Date();
    return rows.map((r) => ({ ...toView(r, now), createdBy: r.createdBy ?? null }));
}

export interface RotateApiKeyInput {
    tenantId: string;
    id: string;
    graceHours: number;
    createdBy?: string | null;
    now?: Date;
}

export interface RotateApiKeyResult {
    key: string;
    apiKey: ApiKeyView;
    previous: { id: string; prefix: string; expiresAt: Date | null; revokedAt: Date | null };
}

/**
 * Replace a key: a new key with the same name and scopes (shown once), and the
 * old key expiring after `graceHours` (0 = revoked now). Only an `active` key
 * can be rotated: a revoked, expired or already-rotating key is `not_active`
 * (to cut a grace period short, revoke the old key).
 */
export async function rotateApiKey(prisma: PrismaLike, input: RotateApiKeyInput): Promise<RotateApiKeyResult> {
    const now = input.now ?? new Date();
    const { tenantId, id, graceHours } = input;
    if (!Number.isInteger(graceHours) || graceHours < 0 || graceHours > MAX_ROTATION_GRACE_HOURS) {
        throw new ApiKeyError('invalid_grace', `Grace period must be a whole number of hours from 0 to ${MAX_ROTATION_GRACE_HOURS}`);
    }

    const old = await prisma.apiKey.findFirst({
        where: { id, tenantId },
        select: { id: true, name: true, prefix: true, scopes: true, revokedAt: true, expiresAt: true },
    });
    if (!old) throw new ApiKeyError('not_found', 'API key not found');
    if (apiKeyStatus(old, now) !== 'active') {
        throw new ApiKeyError('not_active', 'Only an active key can be rotated. This key is revoked, expired or already being replaced.');
    }

    const scopes = (old.scopes as string[]).filter(isApiKeyScope);
    if (scopes.length === 0) throw new ApiKeyError('invalid_scopes', 'This key has no scopes that still exist; create a new key instead');

    // The replacement takes the old key's place in the active count, so the
    // active limit never blocks a rotation. A grace period does add a working
    // key for a while; cap those so rotation cannot be used to pile them up.
    // Soft, like the create limit: parallel rotations of different keys can
    // overshoot by a few. It bounds hygiene, it is not a security line.
    if (graceHours > 0) {
        const working = await prisma.apiKey.count({ where: workingKeyWhere(tenantId, now) });
        if (working >= MAX_VALID_KEYS_PER_TENANT) {
            throw new ApiKeyError('key_limit_reached', `Too many keys are still working (${MAX_VALID_KEYS_PER_TENANT} at most, including keys in a grace period). Revoke some first.`);
        }
    }

    const expiresAt = graceHours > 0 ? new Date(now.getTime() + graceHours * HOUR_MS) : null;
    const revokedAt = graceHours > 0 ? null : now;

    return prisma.$transaction(async (tx: PrismaLike) => {
        // Conditional on "still active", so a concurrent rotate or revoke that
        // got there first makes this one fail instead of issuing a second key.
        const { count } = await tx.apiKey.updateMany({
            where: { id, tenantId, revokedAt: null, expiresAt: null },
            data: expiresAt ? { expiresAt } : { revokedAt },
        });
        if (count !== 1) throw new ApiKeyError('not_active', 'This key was changed while rotating it. Refresh and try again.');

        const created = await insertKey(tx, { tenantId, name: old.name, scopes, createdBy: input.createdBy ?? null, rotatedFromId: id }, 0);
        return { ...created, previous: { id, prefix: old.prefix, expiresAt, revokedAt } };
    });
}

/**
 * Revoke every key that still works (active or in grace). Keys whose grace
 * already ran out are left as they are: they are dead already, and counting
 * them would tell the owner we revoked keys they had stopped using. Returns how
 * many changed.
 */
export async function revokeAllApiKeys(prisma: PrismaLike, tenantId: string, now: Date = new Date()): Promise<number> {
    const { count } = await prisma.apiKey.updateMany({ where: workingKeyWhere(tenantId, now), data: { revokedAt: now } });
    return count;
}

export async function revokeApiKey(
    prisma: PrismaLike,
    tenantId: string,
    id: string,
): Promise<'revoked' | 'already_revoked' | 'not_found'> {
    const { count } = await prisma.apiKey.updateMany({
        where: { id, tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    if (count === 1) return 'revoked';
    const exists = await prisma.apiKey.findFirst({ where: { id, tenantId }, select: { id: true } });
    return exists ? 'already_revoked' : 'not_found';
}

export interface VerifiedApiKey {
    id: string;
    tenantId: string;
    prefix: string;
    scopes: string[];
    name: string;
    lastUsedAt: Date | null;
}

const DUMMY_HASH = hashSecret('bookly-dummy-secret-for-constant-time-compare');

/** Identity of a key whose secret matched but which may no longer be used. Never the secret. */
export interface RefusedKeyIdentity {
    id: string;
    tenantId: string;
    prefix: string;
    name: string;
}

export type ApiKeyCheck =
    | { ok: true; key: VerifiedApiKey }
    | { ok: false; reason: 'malformed' | 'unknown' | 'bad_secret' | 'tenant_inactive' }
    | { ok: false; reason: 'revoked' | 'expired'; key: RefusedKeyIdentity };

/**
 * Verify a raw key and say why it failed. The reason is for the server only
 * (alerting); callers must answer every failure identically. A revoked or
 * expired key is reported with its identity ONLY when the secret matched, so a
 * forged secret on a known prefix learns and triggers nothing.
 *
 * Runs BEFORE a tenant context is bound (the tenant is what we are finding
 * out), which is why the prefix lookup is the one unscoped ApiKey query.
 */
export async function checkApiKey(prisma: PrismaLike, raw: unknown, now: Date = new Date()): Promise<ApiKeyCheck> {
    const parsed = parseApiKey(raw);
    if (!parsed) return { ok: false, reason: 'malformed' };

    const row = await prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    const secretOk = verifySecret(parsed.secret, row?.secretHash ?? DUMMY_HASH);
    if (!row) return { ok: false, reason: 'unknown' };
    if (!secretOk) return { ok: false, reason: 'bad_secret' };

    const status = apiKeyStatus(row, now);
    if (status === 'revoked' || status === 'expired') {
        return { ok: false, reason: status, key: { id: row.id, tenantId: row.tenantId, prefix: row.prefix, name: row.name } };
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { isActive: true } });
    if (!tenant?.isActive) return { ok: false, reason: 'tenant_inactive' };

    return {
        ok: true,
        key: {
            id: row.id,
            tenantId: row.tenantId,
            prefix: row.prefix,
            scopes: row.scopes,
            name: row.name,
            lastUsedAt: row.lastUsedAt ?? null,
        },
    };
}

/**
 * Resolve a raw key to its identity, or null. Every failure (malformed,
 * unknown, wrong secret, revoked, expired, tenant switched off) is the same
 * null so the caller cannot tell a probe which part was wrong.
 */
export async function verifyApiKey(prisma: PrismaLike, raw: unknown, now: Date = new Date()): Promise<VerifiedApiKey | null> {
    const result = await checkApiKey(prisma, raw, now);
    return result.ok ? result.key : null;
}

/**
 * A revoked or expired key was presented WITH its real secret: likely a leaked
 * key being tried, or a client that missed a rotation. One PlatformAlert per
 * key per UTC day (repeats bump its counter). Never throws; never sees the secret.
 */
export async function alertRevokedKeyUse(
    prisma: PrismaLike,
    key: RefusedKeyIdentity,
    reason: 'revoked' | 'expired',
    opts: { ip?: string; now?: Date },
): Promise<void> {
    const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
    try {
        await raiseAlert(prisma, {
            kind: 'api_key.revoked_used',
            severity: 'warning',
            tenantId: key.tenantId,
            // The key name is owner-chosen text: context only, never the message.
            message: `API key bk_live_${key.prefix}… was used after it was ${reason}`,
            context: { apiKeyId: key.id, prefix: key.prefix, name: key.name, reason, ...(opts.ip ? { ip: opts.ip } : {}) },
            dedupeKey: `api_key.revoked_used:${key.id}:${day}`,
        });
    } catch {
        // raiseAlert already never throws; belt and braces for the auth path.
    }
}

/** Throttled, tenant-scoped, and throttled again in SQL so racing instances stay quiet. */
export async function touchLastUsed(prisma: PrismaLike, key: VerifiedApiKey, now: Date = new Date()): Promise<void> {
    if (key.lastUsedAt && now.getTime() - key.lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;
    await prisma.apiKey.updateMany({
        where: {
            id: key.id,
            tenantId: key.tenantId,
            OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }],
        },
        data: { lastUsedAt: now },
    });
}
