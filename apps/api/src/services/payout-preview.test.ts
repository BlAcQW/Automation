import { describe, expect, it, vi } from 'vitest';
import {
    PREVIEW_CACHE_MAX,
    PREVIEW_CACHE_MS,
    PREVIEW_DAILY_MAX,
    PREVIEW_GLOBAL_HOURLY_MAX,
    PREVIEW_GLOBAL_WINDOW_MS,
    PREVIEW_WINDOW_MAX,
    PREVIEW_WINDOW_MS,
    PreviewRateLimitedError,
    createPreviewGuard,
    previewAccountName,
} from './payout-preview.js';

function setup() {
    let t = 1_000_000;
    const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
    const guard = createPreviewGuard(clock.now);
    const resolve = vi.fn(async (_n: string, _p: string) => 'Ama Mensah' as string | null);
    const lookup = (tenantId: string, n = '0241234567', provider = 'MTN') =>
        previewAccountName({ guard, tenantId, accountNumber: n, provider, resolve });
    return { clock, guard, resolve, lookup };
}

describe('previewAccountName', () => {
    it('resolves through the provider and returns the name', async () => {
        const { lookup, resolve } = setup();
        expect(await lookup('t1')).toBe('Ama Mensah');
        expect(resolve).toHaveBeenCalledWith('0241234567', 'MTN');
    });

    it('serves a repeat lookup from the cache without calling the provider again', async () => {
        const { lookup, resolve } = setup();
        await lookup('t1');
        await lookup('t1');
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('a cache hit does not count against the rate limit', async () => {
        const { lookup } = setup();
        for (let i = 0; i < PREVIEW_WINDOW_MAX * 3; i++) await lookup('t1');
        await expect(lookup('t1')).resolves.toBe('Ama Mensah');
    });

    it('the cache expires', async () => {
        const { lookup, resolve, clock } = setup();
        await lookup('t1');
        clock.advance(PREVIEW_CACHE_MS + 1);
        await lookup('t1');
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('the cache is per tenant: one tenant cannot read what another looked up', async () => {
        const { lookup, resolve } = setup();
        await lookup('t1');
        await lookup('t2');
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('does not cache "could not resolve" (it may be transient)', async () => {
        const { guard, resolve } = setup();
        resolve.mockResolvedValueOnce(null).mockResolvedValueOnce('Kofi');
        const go = () => previewAccountName({ guard, tenantId: 't1', accountNumber: '0241234567', provider: 'MTN', resolve });
        expect(await go()).toBeNull();
        expect(await go()).toBe('Kofi');
    });

    it('keys the cache on number AND network', async () => {
        const { lookup, resolve } = setup();
        await lookup('t1', '0241234567', 'MTN');
        await lookup('t1', '0241234567', 'VOD');
        await lookup('t1', '0241234568', 'MTN');
        expect(resolve).toHaveBeenCalledTimes(3);
    });
});

describe('per-tenant limit on NEW lookups (the number-to-name oracle)', () => {
    it('refuses the lookup after the window quota, and says when to retry', async () => {
        const { lookup, resolve } = setup();
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) await lookup('t1', `02412345${String(i).padStart(2, '0')}`);
        const err: any = await lookup('t1', '0249999999').catch((e) => e);
        expect(err).toBeInstanceOf(PreviewRateLimitedError);
        expect(err.retryAfterSec).toBeGreaterThan(0);
        expect(resolve).toHaveBeenCalledTimes(PREVIEW_WINDOW_MAX);
    });

    it('is per tenant: one tenant being limited does not affect another', async () => {
        const { lookup } = setup();
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) await lookup('t1', `02412345${String(i).padStart(2, '0')}`);
        await expect(lookup('t2', '0240000001')).resolves.toBe('Ama Mensah');
    });

    it('the window slides: allowed again once it has passed', async () => {
        const { lookup, clock } = setup();
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) await lookup('t1', `02412345${String(i).padStart(2, '0')}`);
        clock.advance(PREVIEW_WINDOW_MS + 1);
        await expect(lookup('t1', '0249999999')).resolves.toBe('Ama Mensah');
    });

    it('a daily ceiling holds even when every window is respected', async () => {
        const { lookup, clock } = setup();
        let n = 0;
        let refused = false;
        for (let w = 0; w < 20 && !refused; w++) {
            for (let i = 0; i < PREVIEW_WINDOW_MAX && !refused; i++) {
                try { await lookup('t1', `0241${String(n++).padStart(6, '0')}`); } catch (e) {
                    if (e instanceof PreviewRateLimitedError) refused = true; else throw e;
                }
            }
            clock.advance(PREVIEW_WINDOW_MS + 1);
        }
        expect(refused).toBe(true);
        expect(n).toBeLessThanOrEqual(PREVIEW_DAILY_MAX + 1);
    });

    it('a failed provider call still counts (it is the call that is limited)', async () => {
        const { guard, resolve } = setup();
        resolve.mockRejectedValue(new Error('down'));
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) {
            await previewAccountName({ guard, tenantId: 't1', accountNumber: `02412345${String(i).padStart(2, '0')}`, provider: 'MTN', resolve }).catch(() => undefined);
        }
        await expect(previewAccountName({ guard, tenantId: 't1', accountNumber: '0249999999', provider: 'MTN', resolve }))
            .rejects.toBeInstanceOf(PreviewRateLimitedError);
    });
});

describe('memory is bounded', () => {
    it('evicts the oldest cache entries beyond the maximum', async () => {
        const { guard, resolve, clock } = setup();
        for (let i = 0; i < PREVIEW_CACHE_MAX + 20; i++) {
            await previewAccountName({ guard, tenantId: `tenant${i}`, accountNumber: '0241234567', provider: 'MTN', resolve });
            clock.advance(1);
        }
        expect(guard.cacheSize()).toBeLessThanOrEqual(PREVIEW_CACHE_MAX);
    });
});

/** A minimal Redis: INCR + EXPIRE with real TTL handling against the fake clock. */
function fakeRedis(clock: { now: () => number }) {
    const store = new Map<string, { n: number; exp: number | null }>();
    const live = (k: string) => {
        const e = store.get(k);
        if (e && e.exp !== null && e.exp <= clock.now()) { store.delete(k); return undefined; }
        return e;
    };
    return {
        store,
        incr: vi.fn(async (k: string) => { const e = live(k) ?? { n: 0, exp: null }; e.n += 1; store.set(k, e); return e.n; }),
        expire: vi.fn(async (k: string, sec: number) => { const e = live(k); if (e) e.exp = clock.now() + sec * 1000; return 1; }),
    } as any;
}

describe('platform-wide hourly ceiling (many tenants cannot add up to an oracle)', () => {
    const numberFor = (i: number) => `0241${String(i).padStart(6, '0')}`;

    it('refuses once ALL tenants together have used the hourly ceiling, whoever asks', async () => {
        const { lookup, resolve } = setup();
        for (let i = 0; i < PREVIEW_GLOBAL_HOURLY_MAX; i++) await lookup(`tenant${i}`, numberFor(i));
        const err: any = await lookup('brand-new-tenant', numberFor(999_999)).catch((e) => e);
        expect(err).toBeInstanceOf(PreviewRateLimitedError);
        expect(err.scope).toBe('platform');
        expect(err.retryAfterSec).toBeGreaterThan(0);
        expect(resolve).toHaveBeenCalledTimes(PREVIEW_GLOBAL_HOURLY_MAX);
    });

    it('a cache hit never counts against the platform ceiling', async () => {
        const { lookup, resolve } = setup();
        for (let i = 0; i < PREVIEW_GLOBAL_HOURLY_MAX; i++) await lookup(`tenant${i}`, numberFor(i));
        const last = PREVIEW_GLOBAL_HOURLY_MAX - 1; // the oldest entries are evicted from the bounded cache
        await expect(lookup(`tenant${last}`, numberFor(last))).resolves.toBe('Ama Mensah');
        expect(resolve).toHaveBeenCalledTimes(PREVIEW_GLOBAL_HOURLY_MAX);
    });

    it('frees up after the hour', async () => {
        const { lookup, clock } = setup();
        for (let i = 0; i < PREVIEW_GLOBAL_HOURLY_MAX; i++) await lookup(`tenant${i}`, numberFor(i));
        clock.advance(PREVIEW_GLOBAL_WINDOW_MS + 1);
        await expect(lookup('late', numberFor(1))).resolves.toBe('Ama Mensah');
    });

    it('a tenant refused on its OWN quota does not burn the platform ceiling', async () => {
        const { lookup, guard } = setup();
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) await lookup('t1', numberFor(i));
        for (let i = 0; i < 50; i++) await lookup('t1', numberFor(1000 + i)).catch(() => undefined);
        let ok = 0;
        for (let i = 0; i < PREVIEW_GLOBAL_HOURLY_MAX - PREVIEW_WINDOW_MAX; i++) {
            await previewAccountName({ guard, tenantId: `o${i}`, accountNumber: numberFor(5000 + i), provider: 'MTN', resolve: async () => 'x' });
            ok++;
        }
        expect(ok).toBe(PREVIEW_GLOBAL_HOURLY_MAX - PREVIEW_WINDOW_MAX);
    });
});

describe('Redis-backed counters (shared across instances), memory fallback', () => {
    it('two instances share one tenant quota through Redis', async () => {
        const clock = { now: () => 1_000_000 };
        const redis = fakeRedis(clock);
        const a = createPreviewGuard(clock.now);
        const b = createPreviewGuard(clock.now);
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) {
            await (i % 2 ? a : b).consume('t1', redis);
        }
        await expect(a.consume('t1', redis)).rejects.toBeInstanceOf(PreviewRateLimitedError);
        await expect(b.consume('t1', redis)).rejects.toBeInstanceOf(PreviewRateLimitedError);
    });

    it('two instances share the platform ceiling through Redis', async () => {
        const clock = { now: () => 1_000_000 };
        const redis = fakeRedis(clock);
        const a = createPreviewGuard(clock.now);
        const b = createPreviewGuard(clock.now);
        for (let i = 0; i < PREVIEW_GLOBAL_HOURLY_MAX; i++) await (i % 2 ? a : b).consume(`t${i}`, redis);
        const err: any = await a.consume('fresh', redis).catch((e) => e);
        expect(err).toBeInstanceOf(PreviewRateLimitedError);
        expect(err.scope).toBe('platform');
    });

    it('counters expire in Redis (a TTL is set on first use of a window)', async () => {
        const clock = { now: () => 1_000_000 };
        const redis = fakeRedis(clock);
        await createPreviewGuard(clock.now).consume('t1', redis);
        expect(redis.expire).toHaveBeenCalled();
        for (const [, ttl] of redis.expire.mock.calls) expect(ttl).toBeGreaterThan(0);
    });

    it('a Redis error falls back to memory: the limit still holds, nothing throws unexpectedly', async () => {
        const broken: any = { incr: vi.fn(async () => { throw new Error('redis down'); }), expire: vi.fn() };
        const guard = createPreviewGuard(() => 1_000_000);
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) await guard.consume('t1', broken);
        await expect(guard.consume('t1', broken)).rejects.toBeInstanceOf(PreviewRateLimitedError);
    });

    it('no Redis: memory is used', async () => {
        const guard = createPreviewGuard(() => 1_000_000);
        for (let i = 0; i < PREVIEW_WINDOW_MAX; i++) await guard.consume('t1', null);
        await expect(guard.consume('t1', null)).rejects.toBeInstanceOf(PreviewRateLimitedError);
    });
});
