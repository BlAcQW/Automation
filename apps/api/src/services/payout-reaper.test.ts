import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
const auditMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./audit.js', () => ({ audit: auditMock }));

import { PAYOUT_STALE_AFTER_MS, reapStalePayouts, startPayoutReaper } from './payout-reaper.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const stale = (over: Record<string, unknown> = {}) => ({
    id: 'p1', tenantId: 't1', status: 'PROCESSING', amountMinor: 5000, currency: 'GHS', providerRef: 'TRF_1',
    createdAt: new Date(NOW.getTime() - 3 * 3600_000), updatedAt: new Date(NOW.getTime() - 2 * 3600_000), ...over,
});

function makePrisma(rows: unknown[] = [], alreadyAlerted: string[] = []) {
    return {
        payoutRequest: {
            findMany: vi.fn(async () => rows),
            updateMany: vi.fn(),
            update: vi.fn(),
        },
        platformAlert: {
            findUnique: vi.fn(async ({ where }: any) => (alreadyAlerted.includes(where.dedupeKey) ? { id: 'a' } : null)),
        },
    } as any;
}

beforeEach(() => { raise.mockClear(); auditMock.mockClear(); Object.values(log).forEach((f: any) => f.mockClear()); });
afterEach(() => { vi.useRealTimers(); });

describe('reapStalePayouts', () => {
    it('looks only at in-flight payouts that have not changed for a long time', async () => {
        const prisma = makePrisma();
        await reapStalePayouts(prisma, log, NOW);
        expect(prisma.payoutRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                status: { in: ['REQUESTED', 'PROCESSING'] },
                updatedAt: { lt: new Date(NOW.getTime() - PAYOUT_STALE_AFTER_MS) },
            },
            take: expect.any(Number),
        }));
    });

    it('flags each stale payout for reconciliation with a critical alert and an audit row', async () => {
        const prisma = makePrisma([stale()]);
        const r = await reapStalePayouts(prisma, log, NOW);
        expect(r).toEqual({ flagged: 1 });
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'payout.stale', severity: 'critical', tenantId: 't1', dedupeKey: 'payout.stale:p1',
            context: expect.objectContaining({ payoutId: 'p1', status: 'PROCESSING', providerRef: 'TRF_1', amountMinor: 5000, currency: 'GHS' }),
        }));
        expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
            action: 'payout.needs_reconciliation', actorType: 'SYSTEM', tenantId: 't1', targetType: 'PayoutRequest', targetId: 'p1',
        }));
    });

    it('NEVER changes the payout or moves money: an uncertain transfer may well have been sent', async () => {
        const prisma = makePrisma([stale({ status: 'REQUESTED', providerRef: null })]);
        await reapStalePayouts(prisma, log, NOW);
        expect(prisma.payoutRequest.updateMany).not.toHaveBeenCalled();
        expect(prisma.payoutRequest.update).not.toHaveBeenCalled();
    });

    it('does not re-alert a payout it already flagged (no count inflation, no reopening)', async () => {
        const prisma = makePrisma([stale()], ['payout.stale:p1']);
        expect(await reapStalePayouts(prisma, log, NOW)).toEqual({ flagged: 0 });
        expect(raise).not.toHaveBeenCalled();
        expect(auditMock).not.toHaveBeenCalled();
    });

    it('nothing stale is a no-op', async () => {
        expect(await reapStalePayouts(makePrisma(), log, NOW)).toEqual({ flagged: 0 });
    });
});

describe('startPayoutReaper', () => {
    it('runs on a timer, survives a failing sweep, and stops when told', async () => {
        vi.useFakeTimers();
        const prisma = makePrisma();
        prisma.payoutRequest.findMany = vi.fn(async () => { throw new Error('db down'); });
        const stop = startPayoutReaper(prisma, log);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(prisma.payoutRequest.findMany).toHaveBeenCalledTimes(2);
        expect(log.error).toHaveBeenCalled();
        stop();
        await vi.advanceTimersByTimeAsync(20 * 60_000);
        expect(prisma.payoutRequest.findMany).toHaveBeenCalledTimes(2);
    });
});

describe('reapStalePayouts paging', () => {
    it('a full page of already-flagged payouts does not hide a newer stuck one', async () => {
        const flaggedPage = Array.from({ length: 50 }, (_, i) => stale({ id: `old${i}` }));
        const prisma = makePrisma([], flaggedPage.map((p) => `payout.stale:${p.id}`));
        prisma.payoutRequest.findMany
            .mockResolvedValueOnce(flaggedPage)
            .mockResolvedValueOnce([stale({ id: 'new1' })]);
        const r = await reapStalePayouts(prisma, log, NOW);
        expect(r).toEqual({ flagged: 1 });
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({ dedupeKey: 'payout.stale:new1' }));
        // The second page continues after the last row of the first.
        expect(prisma.payoutRequest.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'old49' }, skip: 1 });
    });
});
