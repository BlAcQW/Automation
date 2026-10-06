import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refundMock = vi.hoisted(() => vi.fn());
vi.mock('./wallet-refund.js', async (orig) => ({
    ...(await orig<typeof import('./wallet-refund.js')>()),
    refundDepositForBooking: refundMock,
}));
const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));

import {
    REFUND_STRANDED_AFTER_MS,
    retryDueRefunds,
    startRefundRetrySweeper,
} from './refund-retry.js';

const NOW = new Date('2026-10-07T10:00:00Z');
const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makePrisma(due: Array<{ id: string; tenantId: string }> = []) {
    return {
        booking: {
            updateMany: vi.fn(async () => ({ count: 0 })),
            findMany: vi.fn(async () => due),
        },
    } as any;
}

beforeEach(() => {
    refundMock.mockReset();
    raise.mockClear();
    Object.values(log).forEach((f: any) => f.mockClear());
});
afterEach(() => { vi.useRealTimers(); });

describe('retryDueRefunds', () => {
    it('selects only parked deposits whose next attempt is due, oldest first, bounded', async () => {
        const prisma = makePrisma();
        await retryDueRefunds(prisma, log, NOW);
        expect(prisma.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { depositState: 'REFUND_PENDING', refundNextAttemptAt: { lte: NOW } },
            orderBy: { refundNextAttemptAt: 'asc' },
            take: expect.any(Number),
        }));
    });

    it('retries each due booking in retry mode, scoped to its own tenant', async () => {
        refundMock.mockResolvedValue({ refunded: true, amountMinor: 5000 });
        const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }, { id: 'b2', tenantId: 't2' }]);
        const r = await retryDueRefunds(prisma, log, NOW);
        expect(refundMock).toHaveBeenCalledTimes(2);
        expect(refundMock).toHaveBeenCalledWith(expect.objectContaining({ prisma, tenantId: 't1', bookingId: 'b1', retry: true, now: NOW }));
        expect(refundMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't2', bookingId: 'b2', retry: true }));
        expect(r).toMatchObject({ attempted: 2, refunded: 2 });
    });

    it('one booking throwing does not stop the rest', async () => {
        refundMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ refunded: true });
        const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }, { id: 'b2', tenantId: 't1' }]);
        const r = await retryDueRefunds(prisma, log, NOW);
        expect(refundMock).toHaveBeenCalledTimes(2);
        expect(r).toMatchObject({ attempted: 2, refunded: 1, errored: 1 });
        expect(log.error).toHaveBeenCalled();
    });

    it('a still-failing refund is left to its own backoff (no extra bookkeeping here)', async () => {
        refundMock.mockResolvedValue({ refunded: false, reason: 'provider_failed' });
        const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }]);
        const r = await retryDueRefunds(prisma, log, NOW);
        expect(r.refunded).toBe(0);
        // only the stranded-claim recovery touches booking rows, not the failure itself
        expect(prisma.booking.updateMany).toHaveBeenCalledTimes(1);
    });

    it.each(['nothing_to_refund', 'not_platform_collected', 'no_reference'] as const)(
        'a parked deposit that turns out to have nothing to refund (%s) stops being retried and is flagged',
        async (reason) => {
            refundMock.mockResolvedValue({ refunded: false, reason });
            const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }]);
            prisma.booking.updateMany = vi.fn(async (a: any) => ({ count: a.where.depositState === 'REFUND_PENDING' ? 1 : 0 }));
            await retryDueRefunds(prisma, log, NOW);
            const stop = prisma.booking.updateMany.mock.calls.map((c: any[]) => c[0])
                .find((a: any) => a.where.depositState === 'REFUND_PENDING' && a.where.id === 'b1');
            expect(stop).toMatchObject({
                where: { id: 'b1', tenantId: 't1', depositState: 'REFUND_PENDING' },
                data: { refundNextAttemptAt: null, refundLastError: `skipped: ${reason}` },
            });
            expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
                kind: 'refund.retry_skipped', tenantId: 't1', dedupeKey: 'refund.retry_skipped:b1',
            }));
        },
    );

    it('a lost claim (another sweeper holds it) does nothing: no stop, no alert, not counted as refunded', async () => {
        refundMock.mockResolvedValue({ refunded: false, reason: 'claim_lost' });
        const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }]);
        const r = await retryDueRefunds(prisma, log, NOW);
        expect(r).toMatchObject({ attempted: 1, refunded: 0, errored: 0 });
        expect(prisma.booking.updateMany).toHaveBeenCalledTimes(1); // stranded recovery only
        expect(raise).not.toHaveBeenCalled();
    });

    it('two sweepers: B loses the claim while A re-parks the refund; the parked row keeps its retry time', async () => {
        // Row state shared by both "sweepers".
        const row: any = { depositState: 'REFUND_PENDING', refundNextAttemptAt: NOW };
        const prisma: any = {
            booking: {
                findMany: vi.fn(async () => [{ id: 'b1', tenantId: 't1' }]),
                updateMany: vi.fn(async ({ where, data }: any) => {
                    if (where.depositState !== row.depositState || where.id !== 'b1') return { count: 0 };
                    Object.assign(row, data);
                    return { count: 1 };
                }),
            },
        };
        // B's refund call: A claimed first (REFUNDING) -> B reports claim_lost, then A re-parks
        // BEFORE B's sweeper acts on the outcome. A stale 'nothing_to_refund' mapping would null the retry.
        refundMock.mockImplementation(async () => {
            row.depositState = 'REFUND_PENDING';
            row.refundNextAttemptAt = new Date(NOW.getTime() + 60_000);
            return { refunded: false, reason: 'claim_lost' };
        });
        await retryDueRefunds(prisma, log, NOW);
        expect(row.refundNextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));
        expect(row.refundLastError).toBeUndefined();
        expect(raise).not.toHaveBeenCalled();
    });

    it('a false "dropped" alert is not raised when the stop write matched nothing (state moved on)', async () => {
        refundMock.mockResolvedValue({ refunded: false, reason: 'nothing_to_refund' });
        const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }]); // updateMany -> count 0
        await retryDueRefunds(prisma, log, NOW);
        expect(raise).not.toHaveBeenCalled();
    });

    it('recovers deposits stranded in REFUNDING by a crashed attempt, only once they are old enough', async () => {
        const prisma = makePrisma();
        prisma.booking.updateMany = vi.fn(async () => ({ count: 3 }));
        const r = await retryDueRefunds(prisma, log, NOW);
        expect(prisma.booking.updateMany).toHaveBeenCalledWith({
            where: { depositState: 'REFUNDING', updatedAt: { lt: new Date(NOW.getTime() - REFUND_STRANDED_AFTER_MS) } },
            data: { depositState: 'REFUND_PENDING', refundNextAttemptAt: NOW },
        });
        expect(r.recovered).toBe(3);
    });

    it('nothing due is a cheap no-op', async () => {
        const prisma = makePrisma();
        expect(await retryDueRefunds(prisma, log, NOW)).toMatchObject({ attempted: 0, refunded: 0 });
        expect(refundMock).not.toHaveBeenCalled();
    });
});

describe('startRefundRetrySweeper', () => {
    it('runs on a timer, returns a stop function, and never overlaps itself', async () => {
        vi.useFakeTimers();
        let release: () => void = () => undefined;
        const prisma = makePrisma([{ id: 'b1', tenantId: 't1' }]);
        refundMock.mockImplementation(() => new Promise((res) => { release = () => res({ refunded: true }); }));

        const stop = startRefundRetrySweeper(prisma, log);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(refundMock).toHaveBeenCalledTimes(1);

        // The first sweep is still in flight: the next tick must not start a second one.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(prisma.booking.findMany).toHaveBeenCalledTimes(1);

        release();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(prisma.booking.findMany).toHaveBeenCalledTimes(2);

        stop();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(prisma.booking.findMany).toHaveBeenCalledTimes(2);
    });

    it('a sweep that throws is logged and the timer keeps going', async () => {
        vi.useFakeTimers();
        const prisma = makePrisma();
        prisma.booking.findMany = vi.fn(async () => { throw new Error('db down'); });
        const stop = startRefundRetrySweeper(prisma, log);
        await vi.advanceTimersByTimeAsync(60_000);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(prisma.booking.findMany).toHaveBeenCalledTimes(2);
        expect(log.error).toHaveBeenCalled();
        stop();
    });
});
