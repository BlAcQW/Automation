/**
 * Failure throttles and one-shot markers for admin sign-in, on Redis when the
 * app has it (so limits hold across API instances) and in process memory when
 * it does not (local dev) or when Redis errors (never lock everyone out, and
 * never skip the limit, just because Redis blinked).
 *
 * Used for: per-account password failures, per-admin TOTP failures, and the
 * "this TOTP step was already used" replay record.
 *
 * Keys are caller-chosen opaque strings; callers hash anything personal
 * (an email) before it gets here.
 */
import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';
import { config } from '../config/index.js';

export type ThrottleRedis = Pick<Redis, 'get' | 'set' | 'incr' | 'expire' | 'del'>;

export interface FailurePolicy {
    /** Failures inside one window that trigger the lock. */
    max: number;
    /** Both the counting window and the lock duration. */
    lockMs: number;
}

const PREFIX = 'admin:throttle:';

/**
 * A stable, non-reversible tag for an email: usable as a throttle key and in
 * audit rows without storing what a stranger typed into the sign-in form.
 * Keyed, so the table of tags cannot be brute-forced offline from a leak.
 */
export function emailTag(email: string): string {
    return createHmac('sha256', config.adminJwtSecret).update(email.trim().toLowerCase()).digest('hex').slice(0, 24);
}

const memFailures = new Map<string, { count: number; windowEnds: number; lockedUntil: number }>();
const memValues = new Map<string, { value: string; expiresAt: number }>();

/** Test helper: forget everything held in process memory. */
export function resetThrottleMemory(): void {
    memFailures.clear();
    memValues.clear();
}

const failKey = (key: string) => `${PREFIX}fail:${key}`;
const lockKey = (key: string) => `${PREFIX}lock:${key}`;
const valKey = (key: string) => `${PREFIX}val:${key}`;

export async function isLocked(redis: ThrottleRedis | null | undefined, key: string, now: number = Date.now()): Promise<boolean> {
    if (redis) {
        try {
            if (await redis.get(lockKey(key))) return true;
        } catch {
            /* fall through to memory */
        }
    }
    const f = memFailures.get(key);
    if (!f) return false;
    if (f.lockedUntil && f.lockedUntil <= now) {
        memFailures.delete(key);
        return false;
    }
    return f.lockedUntil > now;
}

export async function recordFailure(
    redis: ThrottleRedis | null | undefined,
    key: string,
    policy: FailurePolicy,
    now: number = Date.now(),
): Promise<void> {
    if (redis) {
        try {
            const lockSeconds = Math.max(1, Math.ceil(policy.lockMs / 1000));
            const n = await redis.incr(failKey(key));
            if (n === 1) await redis.expire(failKey(key), lockSeconds);
            if (n >= policy.max) await redis.set(lockKey(key), '1', 'EX', lockSeconds);
            return;
        } catch {
            /* fall through to memory */
        }
    }
    const current = memFailures.get(key);
    const fresh = !current || (current.windowEnds <= now && !current.lockedUntil);
    const f = fresh ? { count: 0, windowEnds: now + policy.lockMs, lockedUntil: 0 } : current!;
    f.count += 1;
    if (f.count >= policy.max) f.lockedUntil = now + policy.lockMs;
    memFailures.set(key, f);
}

export async function clearFailures(redis: ThrottleRedis | null | undefined, key: string): Promise<void> {
    memFailures.delete(key);
    if (!redis) return;
    try {
        await redis.del(failKey(key), lockKey(key));
    } catch {
        /* the memory copy is already cleared */
    }
}

export async function getValue(redis: ThrottleRedis | null | undefined, key: string, now: number = Date.now()): Promise<string | null> {
    if (redis) {
        try {
            return await redis.get(valKey(key));
        } catch {
            /* fall through */
        }
    }
    const v = memValues.get(key);
    if (!v || v.expiresAt <= now) return null;
    return v.value;
}

export async function setValue(
    redis: ThrottleRedis | null | undefined,
    key: string,
    value: string,
    ttlSeconds: number,
    now: number = Date.now(),
): Promise<void> {
    if (redis) {
        try {
            await redis.set(valKey(key), value, 'EX', Math.max(1, ttlSeconds));
            return;
        } catch {
            /* fall through */
        }
    }
    memValues.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
}

/** Claim a one-shot marker. True for exactly one caller until it expires. */
export async function claimOnce(
    redis: ThrottleRedis | null | undefined,
    key: string,
    ttlSeconds: number,
    now: number = Date.now(),
): Promise<boolean> {
    if (redis) {
        try {
            return (await redis.set(valKey(key), '1', 'EX', Math.max(1, ttlSeconds), 'NX')) === 'OK';
        } catch {
            /* fall through */
        }
    }
    const v = memValues.get(key);
    if (v && v.expiresAt > now) return false;
    memValues.set(key, { value: '1', expiresAt: now + ttlSeconds * 1000 });
    return true;
}
