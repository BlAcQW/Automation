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
 */

import crypto from 'node:crypto';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';

type PrismaLike = ExtendedPrismaClient | any;

export const API_KEY_SCOPES = [
    'messages:write',
    'conversations:read',
    'conversations:write',
    'customers:read',
    'customers:write',
    'payments:write',
    // No 'events:read': nothing in the API reads events with a key (webhooks are
    // pushed, and the catalogue is public documentation), so a scope that grants
    // nothing would only mislead. Add it back together with the first route that checks it.
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const MAX_ACTIVE_KEYS_PER_TENANT = 20;
export const MAX_KEY_NAME_LENGTH = 60;
/** lastUsedAt is advisory; writing it on every request would turn reads into writes. */
export const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

const KEY_PREFIX_LENGTH = 10;
const SECRET_LENGTH = 48;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEY_PATTERN = /^bk_live_([A-Za-z0-9]{10})_([A-Za-z0-9]{43,64})$/;
const MAX_RAW_KEY_LENGTH = 128;
const PREFIX_RETRIES = 3;

export type ApiKeyErrorCode = 'invalid_scopes' | 'invalid_name' | 'key_limit_reached';

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

export interface ApiKeyView {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}

const VIEW_SELECT = {
    id: true,
    name: true,
    prefix: true,
    scopes: true,
    lastUsedAt: true,
    revokedAt: true,
    createdAt: true,
} as const;

function toView(row: ApiKeyView & Record<string, unknown>): ApiKeyView {
    return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        lastUsedAt: row.lastUsedAt ?? null,
        revokedAt: row.revokedAt ?? null,
        createdAt: row.createdAt,
    };
}

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
    const active = await prisma.apiKey.count({ where: { tenantId: input.tenantId, revokedAt: null } });
    if (active >= MAX_ACTIVE_KEYS_PER_TENANT) {
        throw new ApiKeyError('key_limit_reached', `At most ${MAX_ACTIVE_KEYS_PER_TENANT} active API keys per organisation`);
    }

    for (let attempt = 0; ; attempt++) {
        const { key, prefix, secret } = generateApiKey();
        try {
            const row = await prisma.apiKey.create({
                data: {
                    tenantId: input.tenantId,
                    name,
                    prefix,
                    secretHash: hashSecret(secret),
                    scopes,
                    createdBy: input.createdBy ?? null,
                },
            });
            return { key, apiKey: toView(row) };
        } catch (err) {
            if ((err as { code?: string }).code === 'P2002' && attempt < PREFIX_RETRIES) continue;
            throw err;
        }
    }
}

export async function listApiKeys(prisma: PrismaLike, tenantId: string): Promise<ApiKeyView[]> {
    return prisma.apiKey.findMany({
        where: { tenantId },
        select: VIEW_SELECT,
        orderBy: { createdAt: 'desc' },
    });
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

/**
 * Resolve a raw key to its identity, or null. Every failure (malformed,
 * unknown, wrong secret, revoked, tenant switched off) is the same null so the
 * caller cannot tell a probe which part was wrong.
 *
 * Runs BEFORE a tenant context is bound (the tenant is what we are finding
 * out), which is why the prefix lookup is the one unscoped ApiKey query.
 */
export async function verifyApiKey(prisma: PrismaLike, raw: unknown): Promise<VerifiedApiKey | null> {
    const parsed = parseApiKey(raw);
    if (!parsed) return null;

    const row = await prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    const secretOk = verifySecret(parsed.secret, row?.secretHash ?? DUMMY_HASH);
    if (!row || !secretOk || row.revokedAt) return null;

    const tenant = await prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { isActive: true } });
    if (!tenant?.isActive) return null;

    return {
        id: row.id,
        tenantId: row.tenantId,
        prefix: row.prefix,
        scopes: row.scopes,
        name: row.name,
        lastUsedAt: row.lastUsedAt ?? null,
    };
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
