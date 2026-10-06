import { describe, it, expect, vi } from 'vitest';
import { withConversationLock, LockTimeoutError, type LockRedis } from './conversation-lock.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal Redis double: SET NX PX with expiry, and the compare-and-delete eval. */
function fakeRedis(): LockRedis & { store: Map<string, { v: string; exp: number }> } {
    const store = new Map<string, { v: string; exp: number }>();
    return {
        store,
        async set(key: string, value: string, _px: 'PX', ms: number, _nx: 'NX') {
            const cur = store.get(key);
            if (cur && cur.exp > Date.now()) return null;
            store.set(key, { v: value, exp: Date.now() + ms });
            return 'OK';
        },
        async eval(script: string, _n: number, key: string, token: string, ttl?: string) {
            const cur = store.get(key);
            if (!cur || cur.v !== token) return 0;
            if (script.includes('pexpire')) {
                cur.exp = Date.now() + Number(ttl);
                return 1;
            }
            store.delete(key);
            return 1;
        },
    };
}

async function trace(redis: LockRedis | null) {
    const events: string[] = [];
    const task = (key: string, name: string, ms: number) =>
        withConversationLock(redis, key, async () => {
            events.push(`start:${name}`);
            await sleep(ms);
            events.push(`end:${name}`);
            return name;
        }, { pollMs: 5 });
    return { events, task };
}

describe.each([
    ['in-memory', () => null],
    ['redis', () => fakeRedis()],
])('withConversationLock (%s)', (_label, makeRedis) => {
    it('runs two tasks for one key sequentially', async () => {
        const { events, task } = await trace(makeRedis());
        await Promise.all([task('t:WA:1', 'a', 30), task('t:WA:1', 'b', 5)]);
        expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
    });

    it('runs different keys in parallel', async () => {
        const { events, task } = await trace(makeRedis());
        await Promise.all([task('t:WA:1', 'a', 30), task('t:WA:2', 'b', 30)]);
        expect(events.slice(0, 2).sort()).toEqual(['start:a', 'start:b']);
    });

    it('releases the lock when the task throws', async () => {
        const redis = makeRedis();
        await expect(
            withConversationLock(redis, 'k', async () => { throw new Error('boom'); }, { pollMs: 5 }),
        ).rejects.toThrow('boom');
        await expect(withConversationLock(redis, 'k', async () => 'ok', { pollMs: 5 })).resolves.toBe('ok');
    });

    it('throws LockTimeoutError rather than dropping when the wait is exceeded', async () => {
        const redis = makeRedis();
        const holder = withConversationLock(redis, 'k', () => sleep(80), { pollMs: 5 });
        await sleep(5);
        await expect(
            withConversationLock(redis, 'k', async () => 'never', { waitMs: 20, pollMs: 5 }),
        ).rejects.toBeInstanceOf(LockTimeoutError);
        await holder;
        // A timed-out waiter must not wedge later callers.
        await expect(withConversationLock(redis, 'k', async () => 'ok', { pollMs: 5 })).resolves.toBe('ok');
    });

    it('preserves arrival order across three waiters', async () => {
        const { events, task } = await trace(makeRedis());
        await Promise.all([task('k', 'a', 20), task('k', 'b', 1), task('k', 'c', 1)]);
        expect(events.filter((e) => e.startsWith('start:'))[0]).toBe('start:a');
        // never overlapping
        for (let i = 0; i < events.length; i += 2) {
            expect(events[i].startsWith('start:')).toBe(true);
            expect(events[i + 1]).toBe(events[i].replace('start', 'end'));
        }
    });
});

describe('withConversationLock (redis specifics)', () => {
    it('does not release a lock it no longer owns (safe release)', async () => {
        const redis = fakeRedis();
        await withConversationLock(redis, 'k', async () => {
            // Simulate TTL expiry + another owner taking the lock mid-task.
            redis.store.set('conversation-lock:k', { v: 'someone-else', exp: Date.now() + 10_000 });
        }, { pollMs: 5 });
        expect(redis.store.get('conversation-lock:k')?.v).toBe('someone-else');
    });

    it('falls back to the in-memory chain when redis errors', async () => {
        const broken: LockRedis = {
            set: async () => { throw new Error('ECONNRESET'); },
            eval: async () => { throw new Error('ECONNRESET'); },
        };
        await expect(withConversationLock(broken, 'k', async () => 'ok', { pollMs: 5 })).resolves.toBe('ok');
    });
});

describe('lease renewal (redis)', () => {
    it('extends the lease while the task runs so a slow turn keeps its lock', async () => {
        const redis = fakeRedis();
        let stolen = false;
        const slow = withConversationLock(redis, 'k', async () => { await sleep(150); return 'done'; }, { ttlMs: 60, pollMs: 5 });
        await sleep(10);
        // Without renewal the 60ms lease would have lapsed by now and a second
        // caller could acquire it mid-turn.
        const contender = withConversationLock(redis, 'k', async () => { stolen = true; }, { ttlMs: 60, waitMs: 100, pollMs: 5 });
        await expect(contender).rejects.toBeInstanceOf(LockTimeoutError);
        expect(stolen).toBe(false);
        await expect(slow).resolves.toBe('done');
    });

    it('stops renewing after release', async () => {
        const redis = fakeRedis();
        const spy = vi.spyOn(redis, 'eval');
        await withConversationLock(redis, 'k', async () => { await sleep(40); }, { ttlMs: 30, pollMs: 5 });
        const callsAtRelease = spy.mock.calls.length;
        await sleep(80);
        expect(spy.mock.calls.length).toBe(callsAtRelease);
    });

    it('never renews a lock it no longer owns', async () => {
        const redis = fakeRedis();
        await withConversationLock(redis, 'k', async () => {
            redis.store.set('conversation-lock:k', { v: 'other', exp: Date.now() + 25 });
            await sleep(60);
        }, { ttlMs: 30, pollMs: 5 });
        const cur = redis.store.get('conversation-lock:k');
        // other owner's lease was not extended by us (it expired at +25ms)
        expect(cur?.v).toBe('other');
        expect(cur!.exp).toBeLessThan(Date.now());
    });
});

describe('lease renewal cap and logging', () => {
    it('stops renewing after maxRenewMs so a hung holder loses the lock', async () => {
        const redis = fakeRedis();
        let release!: () => void;
        const hung = withConversationLock(redis, 'k', () => new Promise<void>((r) => { release = r; }), {
            ttlMs: 30, pollMs: 5, maxRenewMs: 60,
        });
        await sleep(150); // renewal stopped at ~60ms, lease lapsed at ~90ms
        const contender = await withConversationLock(redis, 'k', async () => 'got-it', { ttlMs: 30, waitMs: 50, pollMs: 5 });
        expect(contender).toBe('got-it');
        release();
        await hung;
    });

    it('warns when a renewal reports the lock was lost', async () => {
        const redis = fakeRedis();
        const log = { warn: vi.fn() };
        await withConversationLock(redis, 'k', async () => {
            redis.store.set('conversation-lock:k', { v: 'other', exp: Date.now() + 1000 });
            await sleep(60);
        }, { ttlMs: 30, pollMs: 5, log });
        expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'k' }), expect.stringMatching(/lost/i));
    });

    it('warns when a renewal call fails', async () => {
        const redis = fakeRedis();
        const realEval = redis.eval.bind(redis);
        let calls = 0;
        redis.eval = async (...a: any[]) => {
            if (String(a[0]).includes('pexpire')) throw new Error('ECONNRESET');
            calls++;
            return (realEval as any)(...a);
        };
        const log = { warn: vi.fn() };
        await withConversationLock(redis, 'k', async () => { await sleep(60); }, { ttlMs: 30, pollMs: 5, log });
        expect(calls).toBeGreaterThan(0);
        expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.stringMatching(/renew/i));
    });
});
