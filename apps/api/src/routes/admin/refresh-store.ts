/**
 * Admin refresh-token bookkeeping on Redis.
 *
 * A refresh token carries `jti` (this token) and `fam` (the sign-in it
 * descends from; every rotation keeps the family).
 *
 *  - logout revokes the presented token's jti until it would have expired;
 *  - every refresh marks the token it consumed USED. Presenting a used token
 *    again after a short grace window is token reuse (a stolen copy): it is
 *    refused AND the whole family is revoked, so whichever copy is still
 *    live (the thief's or the victim's) stops working and the admin signs in
 *    again. The grace window exists because two browser tabs share one cookie
 *    and may refresh at the same moment;
 *  - a password change (or any "sign everywhere out") stamps a per-admin
 *    cutoff: every refresh token issued at or before it is refused.
 *
 * Without Redis none of that can be enforced, so production FAILS CLOSED:
 * refresh is refused (the session ends with the access token) unless
 * ADMIN_REFRESH_ALLOW_NO_REDIS=true is set on purpose. Dev and test skip the
 * checks.
 */
import type { Redis } from 'ioredis';

export const REUSE_GRACE_MS = 30_000;
const PREFIX = 'admin:rt:';
/** Longer than any refresh token lives, so a revocation outlasts every token it covers. */
const REVOCATION_TTL_SECONDS = 30 * 24 * 60 * 60;

type RedisLike = Pick<Redis, 'get' | 'set'>;

export type RefreshCheck = 'ok' | 'revoked' | 'reused' | 'family_revoked' | 'session_revoked';

export interface RefreshClaims {
    adminId: string;
    jti: string;
    fam: string;
    /** Seconds since epoch, from the JWT. */
    iat?: number;
}

export function refreshAllowedWithoutStore(env: { nodeEnv: string; optOut: string | undefined }): boolean {
    return env.nodeEnv !== 'production' || env.optOut === 'true';
}

export function isRefreshStoreRequired(nodeEnv: string = process.env.NODE_ENV ?? 'development'): boolean {
    return !refreshAllowedWithoutStore({ nodeEnv, optOut: process.env.ADMIN_REFRESH_ALLOW_NO_REDIS });
}

export async function checkRefresh(
    redis: RedisLike | null | undefined,
    claims: RefreshClaims,
    ttlSeconds: number,
    now: number = Date.now(),
): Promise<RefreshCheck> {
    if (!redis) return 'ok';
    if (await redis.get(`${PREFIX}revoked:${claims.jti}`)) return 'revoked';
    if (await redis.get(`${PREFIX}fam:${claims.fam}`)) return 'family_revoked';
    const since = Number(await redis.get(`${PREFIX}since:${claims.adminId}`));
    if (Number.isFinite(since) && since > 0 && (claims.iat === undefined || claims.iat <= since)) return 'session_revoked';

    const ttl = Math.max(1, Math.floor(ttlSeconds));
    const first = await redis.set(`${PREFIX}used:${claims.jti}`, String(now), 'EX', ttl, 'NX');
    if (first === 'OK') return 'ok';
    const usedAt = Number(await redis.get(`${PREFIX}used:${claims.jti}`));
    if (Number.isFinite(usedAt) && now - usedAt <= REUSE_GRACE_MS) return 'ok';
    await revokeFamily(redis, claims.fam);
    return 'reused';
}

export async function revoke(redis: RedisLike | null | undefined, jti: string | undefined, ttlSeconds: number): Promise<void> {
    if (!redis || !jti) return;
    await redis.set(`${PREFIX}revoked:${jti}`, '1', 'EX', Math.max(1, Math.floor(ttlSeconds)));
}

export async function revokeFamily(redis: RedisLike | null | undefined, fam: string | undefined): Promise<void> {
    if (!redis || !fam) return;
    await redis.set(`${PREFIX}fam:${fam}`, '1', 'EX', REVOCATION_TTL_SECONDS);
}

/** Refuse every refresh token this admin was issued up to `nowSeconds` (JWT iat is in seconds). */
export async function revokeAllForAdmin(
    redis: RedisLike | null | undefined,
    adminId: string,
    nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<void> {
    if (!redis) return;
    await redis.set(`${PREFIX}since:${adminId}`, String(nowSeconds), 'EX', REVOCATION_TTL_SECONDS);
}
