/**
 * Per-conversation mutual exclusion.
 *
 * Two inbound messages from one customer arriving together must not both run
 * the agent: each would read the same history and both would reply. The lock is
 * keyed by `tenantId:channel:sender` and the caller waits (bounded) instead of
 * dropping the message.
 *
 * - Redis present: `SET key token NX PX ttl`, released with a compare-and-delete
 *   script so a task whose lease expired can never free someone else's lock.
 *   This is the ONLY mode that is correct with more than one API/worker process.
 * - The lease is renewed every ttl/3 while the task runs, so TTL only has to
 *   cover a crashed holder, not the slowest turn.
 * - No Redis (or Redis erroring): an in-memory promise chain per key. Correct
 *   within one process only. Running several processes without Redis gives no
 *   cross-process ordering.
 */

import crypto from 'node:crypto';

export interface LockRedis {
    set(key: string, value: string, px: 'PX', ms: number, nx: 'NX'): Promise<unknown>;
    eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface LockOptions {
    /** Lease on the Redis key; must exceed the slowest turn (LLM + tools). */
    ttlMs?: number;
    /** How long a waiter queues before giving up with LockTimeoutError. */
    waitMs?: number;
    pollMs?: number;
    /**
     * Stop renewing the lease after this long. A holder that is genuinely hung
     * (no timeout fired) then loses the lock and later messages can proceed
     * instead of queueing behind it forever. Default 10 minutes.
     */
    maxRenewMs?: number;
    /** Receives renewal failures / lost-lock warnings. */
    log?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

export class LockTimeoutError extends Error {
    constructor(public readonly key: string, waitedMs: number) {
        super(`Timed out after ${waitedMs}ms waiting for conversation lock ${key}`);
        this.name = 'LockTimeoutError';
    }
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_WAIT_MS = 120_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_MAX_RENEW_MS = 10 * 60_000;
const KEY_PREFIX = 'conversation-lock:';

const RELEASE_SCRIPT =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Token-checked lease extension: only the current owner may renew. */
const RENEW_SCRIPT =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

const tails = new Map<string, Promise<void>>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withMemoryLock<T>(key: string, fn: () => Promise<T>, waitMs: number): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    // `prev` only ever resolves, so chaining cannot propagate a rejection.
    const tail = prev.then(() => mine);
    tails.set(key, tail);
    const cleanup = () => {
        release();
        void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    };

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), waitMs); });
    const winner = await Promise.race([prev.then(() => 'ready' as const), timedOut]);
    clearTimeout(timer);
    if (winner === 'timeout') {
        cleanup(); // free our slot so later waiters are not wedged behind us
        throw new LockTimeoutError(key, waitMs);
    }
    try {
        return await fn();
    } finally {
        cleanup();
    }
}

async function withRedisLock<T>(
    redis: LockRedis,
    key: string,
    fn: () => Promise<T>,
    ttlMs: number,
    waitMs: number,
    pollMs: number,
    maxRenewMs: number,
    log?: LockOptions['log'],
): Promise<T> {
    const redisKey = KEY_PREFIX + key;
    const token = crypto.randomUUID();
    const deadline = Date.now() + waitMs;

    while ((await redis.set(redisKey, token, 'PX', ttlMs, 'NX')) !== 'OK') {
        if (Date.now() >= deadline) throw new LockTimeoutError(key, waitMs);
        await sleep(pollMs + Math.floor(Math.random() * pollMs));
    }
    // A turn (LLM + tools) can outlive the lease. Extend it while fn runs so a
    // second worker cannot take the lock mid-turn; stop the moment we release.
    const renewUntil = Date.now() + maxRenewMs;
    let lostWarned = false;
    const renewTimer = setInterval(() => {
        if (Date.now() >= renewUntil) {
            // Let the lease lapse: a holder this slow is presumed hung.
            clearInterval(renewTimer);
            log?.warn({ key, maxRenewMs }, 'Conversation lock lease no longer renewed (turn exceeded cap)');
            return;
        }
        redis.eval(RENEW_SCRIPT, 1, redisKey, token, String(ttlMs)).then(
            (res) => {
                if (Number(res) === 0 && !lostWarned) {
                    lostWarned = true;
                    log?.warn({ key }, 'Conversation lock was lost while the turn was still running');
                }
            },
            (err) => log?.warn({ err, key }, 'Conversation lock lease renewal failed'),
        );
    }, Math.max(10, Math.floor(ttlMs / 3)));
    renewTimer.unref?.();
    try {
        return await fn();
    } finally {
        clearInterval(renewTimer);
        await redis.eval(RELEASE_SCRIPT, 1, redisKey, token).catch(() => undefined);
    }
}

export async function withConversationLock<T>(
    redis: LockRedis | null | undefined,
    key: string,
    fn: () => Promise<T>,
    opts: LockOptions = {},
): Promise<T> {
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const maxRenewMs = opts.maxRenewMs ?? DEFAULT_MAX_RENEW_MS;

    if (!redis) return withMemoryLock(key, fn, waitMs);

    // Only the acquire step may fall back; once fn has started its errors are
    // its own and must not trigger a second run.
    let started = false;
    try {
        return await withRedisLock(redis, key, () => { started = true; return fn(); }, ttlMs, waitMs, pollMs, maxRenewMs, opts.log);
    } catch (err) {
        if (started || err instanceof LockTimeoutError) throw err;
        return withMemoryLock(key, fn, waitMs);
    }
}
