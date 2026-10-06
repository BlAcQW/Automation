/**
 * "Whose number is this?" without making it an oracle.
 *
 * The preview resolves a Mobile Money number to its registered name using
 * BOOKLY's shared Paystack key, so every owner can query it. Unlimited, that is
 * a free number-to-name lookup service for anyone who can register a salon, and
 * it spends our provider quota. Three controls (per TENANT, not per IP, which a
 * registered attacker rotates freely, plus one for the whole platform because a
 * per-tenant limit alone is defeated by registering more tenants):
 *
 *  - a quota on NEW lookups per tenant (short window plus a daily ceiling);
 *  - a PLATFORM-wide hourly ceiling across all tenants;
 *  - a short per-tenant cache, so retyping or re-checking the same number costs
 *    nothing and, because it reveals nothing new, does not count.
 *
 * COUNTERS live in Redis when the caller passes it (fixed windows via INCR +
 * EXPIRE, so the limits hold across API instances) and in process memory
 * otherwise or when Redis errors (never skip the limit because Redis blinked;
 * with N instances and no Redis the effective quota is N times higher). A
 * tenant refused on its own quota is not counted against the platform ceiling,
 * so one noisy tenant cannot lock everyone out. The resolved-name cache stays
 * in process: it is an optimisation, not a control.
 */

/** New lookups allowed per tenant per window. */
export const PREVIEW_WINDOW_MAX = 20;
export const PREVIEW_WINDOW_MS = 10 * 60_000;
/** ...and per rolling 24 hours however they are spread. */
export const PREVIEW_DAILY_MAX = 60;
const DAY_MS = 24 * 3600_000;
/** New lookups allowed across ALL tenants per rolling hour (a fraction of the provider's quota). */
export const PREVIEW_GLOBAL_HOURLY_MAX = 600;
export const PREVIEW_GLOBAL_WINDOW_MS = 3600_000;
/** How long a resolved name is reused. */
export const PREVIEW_CACHE_MS = 10 * 60_000;
export const PREVIEW_CACHE_MAX = 500;

/** The two Redis commands the counters need (ioredis satisfies it). */
export interface PreviewRedis {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
}

export class PreviewRateLimitedError extends Error {
    constructor(
        public readonly retryAfterSec: number,
        /** 'tenant' = this tenant used its quota; 'platform' = the shared ceiling is spent. */
        public readonly scope: 'tenant' | 'platform' = 'tenant',
    ) {
        super('Too many number checks');
        this.name = 'PreviewRateLimitedError';
    }
}

export interface PreviewGuard {
    /** Throws PreviewRateLimitedError if this tenant (or the platform) may not make another NEW lookup, else records one. */
    consume(tenantId: string, redis?: PreviewRedis | null): Promise<void>;
    getCached(key: string): string | undefined;
    setCached(key: string, name: string): void;
    cacheSize(): number;
}

export function createPreviewGuard(now: () => number = Date.now): PreviewGuard {
    const usage = new Map<string, number[]>();
    let globalUsage: number[] = [];
    const cache = new Map<string, { name: string; at: number }>();

    function consumeMemory(tenantId: string, t: number): void {
        const recent = (usage.get(tenantId) ?? []).filter((at) => t - at < DAY_MS);
        const inWindow = recent.filter((at) => t - at < PREVIEW_WINDOW_MS);
        usage.set(tenantId, recent);

        if (inWindow.length >= PREVIEW_WINDOW_MAX) {
            throw new PreviewRateLimitedError(Math.max(Math.ceil((inWindow[0] + PREVIEW_WINDOW_MS - t) / 1000), 1));
        }
        if (recent.length >= PREVIEW_DAILY_MAX) {
            throw new PreviewRateLimitedError(Math.max(Math.ceil((recent[0] + DAY_MS - t) / 1000), 1));
        }
        globalUsage = globalUsage.filter((at) => t - at < PREVIEW_GLOBAL_WINDOW_MS);
        if (globalUsage.length >= PREVIEW_GLOBAL_HOURLY_MAX) {
            throw new PreviewRateLimitedError(
                Math.max(Math.ceil((globalUsage[0] + PREVIEW_GLOBAL_WINDOW_MS - t) / 1000), 1), 'platform',
            );
        }
        recent.push(t);
        globalUsage.push(t);
    }

    /** Fixed-window counter: INCR, and set the TTL on the first hit of a window. */
    async function bump(redis: PreviewRedis, scope: string, id: string, windowMs: number, max: number, t: number, platform = false) {
        const bucket = Math.floor(t / windowMs);
        const key = `payout:preview:${scope}:${id}:${bucket}`;
        const n = await redis.incr(key);
        if (n === 1) await redis.expire(key, Math.ceil(windowMs / 1000) + 5);
        if (n > max) {
            const retry = Math.ceil(((bucket + 1) * windowMs - t) / 1000);
            throw new PreviewRateLimitedError(Math.max(retry, 1), platform ? 'platform' : 'tenant');
        }
    }

    async function consumeRedis(redis: PreviewRedis, tenantId: string, t: number): Promise<void> {
        // Tenant first: a tenant over its own quota must not spend the shared one.
        await bump(redis, 'w', tenantId, PREVIEW_WINDOW_MS, PREVIEW_WINDOW_MAX, t);
        await bump(redis, 'd', tenantId, DAY_MS, PREVIEW_DAILY_MAX, t);
        await bump(redis, 'g', 'all', PREVIEW_GLOBAL_WINDOW_MS, PREVIEW_GLOBAL_HOURLY_MAX, t, true);
    }

    return {
        async consume(tenantId, redis) {
            if (redis) {
                try {
                    await consumeRedis(redis, tenantId, now());
                    return;
                } catch (err) {
                    if (err instanceof PreviewRateLimitedError) throw err;
                    // Redis blinked: count in memory rather than skip the limit.
                }
            }
            consumeMemory(tenantId, now());
        },

        getCached(key) {
            const hit = cache.get(key);
            if (!hit) return undefined;
            if (now() - hit.at > PREVIEW_CACHE_MS) {
                cache.delete(key);
                return undefined;
            }
            return hit.name;
        },

        setCached(key, name) {
            cache.delete(key);
            cache.set(key, { name, at: now() });
            // Maps iterate in insertion order, so the first key is the oldest.
            while (cache.size > PREVIEW_CACHE_MAX) {
                const oldest = cache.keys().next().value as string | undefined;
                if (oldest === undefined) break;
                cache.delete(oldest);
            }
        },

        cacheSize: () => cache.size,
    };
}

/** Shared by the route; tests build their own with a fake clock. */
export const defaultPreviewGuard = createPreviewGuard();

export async function previewAccountName(args: {
    guard: PreviewGuard;
    tenantId: string;
    accountNumber: string;
    provider: string;
    resolve: (accountNumber: string, provider: string) => Promise<string | null>;
    /** Shared counters across instances; memory is used when absent or failing. */
    redis?: PreviewRedis | null;
}): Promise<string | null> {
    const key = `${args.tenantId}:${args.provider}:${args.accountNumber}`;
    const cached = args.guard.getCached(key);
    if (cached !== undefined) return cached;

    // Counted BEFORE the call: a provider failure is still a call, and an
    // attacker should not get free retries from errors.
    await args.guard.consume(args.tenantId, args.redis);
    const name = await args.resolve(args.accountNumber, args.provider);
    // "Could not resolve" may be transient, so only a real answer is kept.
    if (name) args.guard.setCached(key, name);
    return name;
}
