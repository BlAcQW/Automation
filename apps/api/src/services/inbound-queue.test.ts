import { describe, it, expect, vi } from 'vitest';
import { LockTimeoutError } from './conversation-lock.js';
import {
    MAX_ATTEMPTS,
    BACKOFF_MS,
    BUSY_RETRY_MS,
    backoffMs,
    purgeInbox,
    PURGE_BATCH,
    PURGE_MAX_BATCHES,
    STUCK_BUSY_MS,
    DONE_RETENTION_MS,
    FAILED_RETENTION_MS,
    nextStateOnFailure,
    persistInbound,
    claimInboxRow,
    processInboxRow,
    sweepInbox,
    dispatchInbound,
} from './inbound-queue.js';

type Row = {
    id: string; source: string; payload: unknown; status: string; attempts: number;
    lastError: string | null; receivedAt: Date; processedAt: Date | null;
    claimedAt: Date | null; nextAttemptAt: Date | null;
};

function fakePrisma(initial: Partial<Row>[] = []) {
    const rows: Row[] = initial.map((r, i) => ({
        id: `r${i}`, source: 'META', payload: { object: 'x' }, status: 'PENDING', attempts: 0,
        lastError: null, receivedAt: new Date(), processedAt: null, claimedAt: null, nextAttemptAt: null, ...r,
    }));
    const cmp = (v: Date | null, c: any): boolean => {
        if (c === null) return v === null;
        if (c === undefined) return true;
        if (v === null) return false;
        return (c.lt === undefined || v < c.lt) && (c.lte === undefined || v <= c.lte);
    };
    const matches = (r: Row, w: any): boolean =>
        (w.id === undefined || (w.id.in ? w.id.in.includes(r.id) : r.id === w.id)) &&
        (w.status === undefined || r.status === w.status) &&
        (w.attempts?.lt === undefined || r.attempts < w.attempts.lt) &&
        cmp(r.receivedAt, w.receivedAt) &&
        cmp(r.claimedAt, w.claimedAt) &&
        cmp(r.nextAttemptAt, w.nextAttemptAt) &&
        (w.OR === undefined || w.OR.some((o: any) => matches(r, o)));
    const webhookInbox = {
        create: vi.fn(async ({ data }: any) => {
            const row: Row = { id: `n${rows.length}`, status: 'PENDING', attempts: 0, lastError: null, receivedAt: new Date(), processedAt: null, ...data };
            rows.push(row);
            return row;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const r of rows.filter((x) => matches(x, where))) {
                const { attempts, ...rest } = data;
                Object.assign(r, rest);
                if (attempts?.increment) r.attempts += attempts.increment;
                if (attempts?.decrement) r.attempts -= attempts.decrement;
                count++;
            }
            return { count };
        }),
        findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
        findMany: vi.fn(async ({ where, take }: any) => rows.filter((r) => matches(r, where)).slice(0, take)),
        deleteMany: vi.fn(async ({ where }: any) => {
            const doomed = rows.filter((r) => matches(r, where));
            for (const r of doomed) rows.splice(rows.indexOf(r), 1);
            return { count: doomed.length };
        }),
    };
    const platformAlert = { upsert: vi.fn(async () => ({})) };
    return { rows, prisma: { webhookInbox, platformAlert } as any };
}

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as any;

describe('nextStateOnFailure', () => {
    it('retries until the cap, then fails', () => {
        expect(nextStateOnFailure(1)).toBe('PENDING');
        expect(nextStateOnFailure(MAX_ATTEMPTS - 1)).toBe('PENDING');
        expect(nextStateOnFailure(MAX_ATTEMPTS)).toBe('FAILED');
        expect(nextStateOnFailure(MAX_ATTEMPTS + 3)).toBe('FAILED');
    });
});

describe('persistInbound', () => {
    it('stores the raw payload as PENDING and returns the id', async () => {
        const { prisma, rows } = fakePrisma();
        const id = await persistInbound(prisma, { object: 'whatsapp_business_account' });
        expect(id).toBe(rows[0].id);
        expect(rows[0]).toMatchObject({ source: 'META', status: 'PENDING', payload: { object: 'whatsapp_business_account' } });
    });

    it('propagates insert failures so the caller can answer 5xx', async () => {
        const { prisma } = fakePrisma();
        prisma.webhookInbox.create.mockRejectedValueOnce(new Error('db down'));
        await expect(persistInbound(prisma, {})).rejects.toThrow('db down');
    });
});

describe('claimInboxRow', () => {
    it('moves PENDING to PROCESSING and increments attempts', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const claimed = await claimInboxRow(prisma, 'r0');
        expect(claimed).toMatchObject({ id: 'r0', attempts: 1 });
        expect(rows[0].status).toBe('PROCESSING');
    });

    it('lets exactly one of two concurrent claimers win', async () => {
        const { prisma } = fakePrisma([{}]);
        const [a, b] = await Promise.all([claimInboxRow(prisma, 'r0'), claimInboxRow(prisma, 'r0')]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it('does not claim DONE, FAILED or PROCESSING rows, or unknown ids', async () => {
        const { prisma } = fakePrisma([{ status: 'DONE' }, { status: 'FAILED' }, { status: 'PROCESSING' }]);
        expect(await claimInboxRow(prisma, 'r0')).toBeNull();
        expect(await claimInboxRow(prisma, 'r1')).toBeNull();
        expect(await claimInboxRow(prisma, 'r2')).toBeNull();
        expect(await claimInboxRow(prisma, 'nope')).toBeNull();
    });
});

describe('processInboxRow', () => {
    it('marks DONE with processedAt on success and passes the payload through', async () => {
        const { prisma, rows } = fakePrisma([{ payload: { object: 'page' } }]);
        const process = vi.fn(async () => undefined);
        expect(await processInboxRow({ prisma, log: log(), process }, 'r0')).toBe('done');
        expect(process).toHaveBeenCalledWith({ object: 'page' });
        expect(rows[0].status).toBe('DONE');
        expect(rows[0].processedAt).toBeInstanceOf(Date);
    });

    it('returns to PENDING with lastError on failure below the cap', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const result = await processInboxRow({ prisma, log: log(), process: async () => { throw new Error('boom'); } }, 'r0');
        expect(result).toBe('retry');
        expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'boom' });
    });

    it('goes FAILED and logs at error once attempts hit the cap', async () => {
        const { prisma, rows } = fakePrisma([{ attempts: MAX_ATTEMPTS - 1 }]);
        const l = log();
        const result = await processInboxRow({ prisma, log: l, process: async () => { throw new Error('still broken'); } }, 'r0');
        expect(result).toBe('failed');
        expect(rows[0]).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, lastError: 'still broken' });
        expect(l.error).toHaveBeenCalled();
        // A permanently failed customer message must reach a person, not just the log.
        expect(prisma.platformAlert.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { dedupeKey: 'inbound.failed:r0' },
        }));
    });

    it('reaches FAILED after exactly MAX_ATTEMPTS runs', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const process = vi.fn(async () => { throw new Error('x'); });
        for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await processInboxRow({ prisma, log: log(), process }, 'r0');
        expect(process).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        expect(rows[0].status).toBe('FAILED');
    });

    it('skips a row someone else already claimed', async () => {
        const { prisma } = fakePrisma([{ status: 'PROCESSING' }]);
        const process = vi.fn();
        expect(await processInboxRow({ prisma, log: log(), process }, 'r0')).toBe('skipped');
        expect(process).not.toHaveBeenCalled();
    });
});

describe('sweepInbox', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);

    it('re-dispatches PENDING rows older than 60s and ignores fresh ones', async () => {
        const { prisma } = fakePrisma([{ receivedAt: ago(90_000) }, { receivedAt: ago(5_000) }]);
        const dispatch = vi.fn();
        const res = await sweepInbox({ prisma, log: log(), dispatch }, now);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith('r0');
        expect(res).toMatchObject({ requeued: 1 });
    });

    it('recovers PROCESSING rows stuck for minutes by resetting to PENDING', async () => {
        const { prisma, rows } = fakePrisma([
            { status: 'PROCESSING', attempts: 1, receivedAt: ago(10 * 60_000), claimedAt: ago(10 * 60_000) },
            { status: 'PROCESSING', attempts: 1, receivedAt: ago(30_000), claimedAt: ago(30_000) },
        ]);
        const dispatch = vi.fn();
        const res = await sweepInbox({ prisma, log: log(), dispatch }, now);
        expect(rows[0].status).toBe('PENDING');
        expect(rows[1].status).toBe('PROCESSING');
        expect(dispatch).toHaveBeenCalledWith('r0');
        expect(res.recovered).toBe(1);
    });

    it('fails a stuck row that already used all its attempts', async () => {
        const { prisma, rows } = fakePrisma([{ status: 'PROCESSING', attempts: MAX_ATTEMPTS, receivedAt: ago(10 * 60_000), claimedAt: ago(10 * 60_000) }]);
        const dispatch = vi.fn();
        const l = log();
        await sweepInbox({ prisma, log: l, dispatch }, now);
        expect(rows[0].status).toBe('FAILED');
        expect(dispatch).not.toHaveBeenCalled();
        expect(l.error).toHaveBeenCalled();
        expect(prisma.platformAlert.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { dedupeKey: 'inbound.failed:r0' },
        }));
    });

    it('never touches DONE or FAILED rows', async () => {
        const { prisma } = fakePrisma([{ status: 'DONE', receivedAt: ago(1e7) }, { status: 'FAILED', receivedAt: ago(1e7) }]);
        const dispatch = vi.fn();
        await sweepInbox({ prisma, log: l0(), dispatch }, now);
        expect(dispatch).not.toHaveBeenCalled();
    });
});
const l0 = log;

describe('backoff and attempts budget', () => {
    it('backs off 30s, 2m, 10m, 30m, 1h and then holds at 1h', () => {
        expect(BACKOFF_MS.slice(0, 5)).toEqual([30_000, 120_000, 600_000, 1_800_000, 3_600_000]);
        expect(backoffMs(1)).toBe(30_000);
        expect(backoffMs(3)).toBe(600_000);
        expect(backoffMs(5)).toBe(3_600_000);
        expect(backoffMs(99)).toBe(3_600_000);
    });

    it('spans more than an hour of outage before giving up', () => {
        let total = 0;
        for (let a = 1; a < MAX_ATTEMPTS; a++) total += backoffMs(a);
        expect(total).toBeGreaterThan(2 * 3_600_000);
    });
});

describe('claim and retry bookkeeping', () => {
    it('stamps claimedAt on claim', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        await claimInboxRow(prisma, 'r0');
        expect(rows[0].claimedAt).toBeInstanceOf(Date);
    });

    it('failure sets nextAttemptAt = now + backoff(attempts), clears claimedAt and re-dispatches with that delay', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const queue = { add: vi.fn(async () => undefined) };
        const before = Date.now();
        const res = await processInboxRow({ prisma, log: log(), queue: queue as any, process: async () => { throw new Error('boom'); } }, 'r0');
        expect(res).toBe('retry');
        expect(rows[0].claimedAt).toBeNull();
        const due = rows[0].nextAttemptAt!.getTime();
        expect(due - before).toBeGreaterThanOrEqual(backoffMs(1));
        expect(due - before).toBeLessThan(backoffMs(1) + 5_000);
        expect(queue.add).toHaveBeenCalledWith('inbound', { id: 'r0' }, expect.objectContaining({ delay: backoffMs(1) }));
        // delayed retry must not reuse the running job's id (BullMQ would drop it)
        expect((queue.add.mock.calls[0] as any)[2].jobId).not.toBe('r0');
    });

    it('lock contention returns the row to PENDING without consuming an attempt', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const queue = { add: vi.fn(async () => undefined) };
        const l = log();
        const res = await processInboxRow({
            prisma, log: l, queue: queue as any,
            process: async () => { throw new LockTimeoutError('t:WHATSAPP:1', 4000); },
        }, 'r0');
        expect(res).toBe('busy');
        expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 0, claimedAt: null });
        expect(rows[0].nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
        expect(rows[0].nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now() + BUSY_RETRY_MS + 1000);
        expect(queue.add).toHaveBeenCalledWith('inbound', { id: 'r0' }, expect.objectContaining({ delay: BUSY_RETRY_MS }));
        expect(prisma.platformAlert.upsert).not.toHaveBeenCalled();
    });

    it('raises a deduped warning alert once a busy row is older than 15 minutes, and still retries', async () => {
        const { prisma, rows } = fakePrisma([{ receivedAt: new Date(Date.now() - STUCK_BUSY_MS - 60_000) }]);
        const queue = { add: vi.fn(async () => undefined) };
        const res = await processInboxRow({
            prisma, log: log(), queue: queue as any,
            process: async () => { throw new LockTimeoutError('k', 1); },
        }, 'r0');
        expect(res).toBe('busy');
        expect(rows[0].status).toBe('PENDING');
        expect(queue.add).toHaveBeenCalled();
        expect(prisma.platformAlert.upsert).toHaveBeenCalledTimes(1);
        const arg = (prisma.platformAlert.upsert.mock.calls as any)[0][0];
        expect(arg.create).toMatchObject({ kind: 'inbound.stuck_busy', severity: 'warning', dedupeKey: 'inbound.stuck_busy:r0' });
    });

    it('a young busy row raises no alert', async () => {
        const { prisma } = fakePrisma([{ receivedAt: new Date(Date.now() - 60_000) }]);
        await processInboxRow({ prisma, log: log(), process: async () => { throw new LockTimeoutError('k', 1); } }, 'r0');
        expect(prisma.platformAlert.upsert).not.toHaveBeenCalled();
    });

    it('a row that is always busy never reaches FAILED', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        for (let i = 0; i < MAX_ATTEMPTS + 3; i++) {
            await processInboxRow({ prisma, log: log(), process: async () => { throw new LockTimeoutError('k', 1); } }, 'r0');
        }
        expect(rows[0].status).toBe('PENDING');
        expect(rows[0].attempts).toBe(0);
    });
});

describe('sweep honours nextAttemptAt', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);

    it('dispatches a PENDING row once nextAttemptAt is due and not before', async () => {
        const { prisma } = fakePrisma([
            { receivedAt: ago(1e6), nextAttemptAt: new Date(now.getTime() + 60_000) }, // r0 backing off
            { receivedAt: ago(1e6), nextAttemptAt: ago(1_000) },                        // r1 due
            { receivedAt: ago(5_000), nextAttemptAt: null },                            // r2 fresh, no schedule
        ]);
        const dispatch = vi.fn();
        await sweepInbox({ prisma, log: log(), dispatch }, now);
        expect(dispatch.mock.calls.map((c) => c[0])).toEqual(['r1']);
    });

    it('a recovered stuck row is made due immediately and dispatched', async () => {
        const { prisma, rows } = fakePrisma([{ status: 'PROCESSING', attempts: 1, receivedAt: ago(1e6), claimedAt: ago(10 * 60_000) }]);
        const dispatch = vi.fn();
        await sweepInbox({ prisma, log: log(), dispatch }, now);
        expect(rows[0].status).toBe('PENDING');
        expect(dispatch).toHaveBeenCalledWith('r0');
    });

    it('does not treat an old receivedAt as stuck when the claim is recent', async () => {
        const { prisma, rows } = fakePrisma([{ status: 'PROCESSING', attempts: 1, receivedAt: ago(3 * 3_600_000), claimedAt: ago(10_000) }]);
        const dispatch = vi.fn();
        await sweepInbox({ prisma, log: log(), dispatch }, now);
        expect(rows[0].status).toBe('PROCESSING');
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('purgeInbox retention', () => {
    const now = new Date('2026-01-31T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const DAY = 86_400_000;

    it('deletes DONE rows older than 7 days and FAILED older than 30 days only', async () => {
        const { prisma, rows } = fakePrisma([
            { status: 'DONE', receivedAt: ago(8 * DAY) },      // purge
            { status: 'DONE', receivedAt: ago(2 * DAY) },      // keep
            { status: 'FAILED', receivedAt: ago(31 * DAY) },   // purge
            { status: 'FAILED', receivedAt: ago(10 * DAY) },   // keep (needs a human)
            { status: 'PENDING', receivedAt: ago(40 * DAY) },  // never
            { status: 'PROCESSING', receivedAt: ago(40 * DAY), claimedAt: ago(40 * DAY) }, // never
        ]);
        const res = await purgeInbox({ prisma, log: log() }, now);
        expect(res).toEqual({ done: 1, failed: 1 });
        expect(rows.map((r) => r.id).sort()).toEqual(['r1', 'r3', 'r4', 'r5']);
        expect(DONE_RETENTION_MS).toBe(7 * DAY);
        expect(FAILED_RETENTION_MS).toBe(30 * DAY);
    });

    it('loops batches so a backlog larger than one batch is drained in one run', async () => {
        const many = Array.from({ length: PURGE_BATCH * 2 + 7 }, () => ({ status: 'DONE', receivedAt: ago(9 * DAY) }));
        const { prisma, rows } = fakePrisma(many);
        const res = await purgeInbox({ prisma, log: log() }, now);
        expect(res.done).toBe(PURGE_BATCH * 2 + 7);
        expect(rows.length).toBe(0);
    });

    it('caps the number of batches per run', async () => {
        const many = Array.from({ length: PURGE_BATCH * (PURGE_MAX_BATCHES + 2) }, () => ({ status: 'DONE', receivedAt: ago(9 * DAY) }));
        const { prisma, rows } = fakePrisma(many);
        const res = await purgeInbox({ prisma, log: log() }, now);
        expect(res.done).toBe(PURGE_BATCH * PURGE_MAX_BATCHES);
        expect(rows.length).toBe(PURGE_BATCH * 2);
    });
});

describe('dispatchInbound', () => {
    it('delays the BullMQ job when asked', async () => {
        const { prisma } = fakePrisma([{}]);
        const queue = { add: vi.fn(async () => undefined) };
        await dispatchInbound({ prisma, log: log(), process: vi.fn(), queue: queue as any }, 'r0', 5000);
        expect(queue.add).toHaveBeenCalledWith('inbound', { id: 'r0' }, expect.objectContaining({ delay: 5000 }));
    });

    it('enqueues on BullMQ with the row id as jobId when a queue exists', async () => {
        const { prisma } = fakePrisma([{}]);
        const queue = { add: vi.fn(async () => undefined) };
        const process = vi.fn();
        await dispatchInbound({ prisma, log: log(), process, queue: queue as any }, 'r0');
        expect(queue.add).toHaveBeenCalledWith('inbound', { id: 'r0' }, expect.objectContaining({ jobId: 'r0' }));
        expect(process).not.toHaveBeenCalled();
    });

    it('processes in-process when there is no queue', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const process = vi.fn(async () => undefined);
        await dispatchInbound({ prisma, log: log(), process, queue: null }, 'r0');
        await vi.waitFor(() => expect(rows[0].status).toBe('DONE'));
    });

    it('falls back to in-process when enqueueing fails', async () => {
        const { prisma, rows } = fakePrisma([{}]);
        const queue = { add: vi.fn(async () => { throw new Error('redis gone'); }) };
        await dispatchInbound({ prisma, log: log(), process: async () => undefined, queue: queue as any }, 'r0');
        await vi.waitFor(() => expect(rows[0].status).toBe('DONE'));
    });
});
