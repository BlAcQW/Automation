import { describe, it, expect, vi, beforeEach } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
vi.mock('./notifications.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
const posts = vi.hoisted(() => ({ postMovement: vi.fn().mockResolvedValue({ duplicate: false }) }));
vi.mock('./ledger.js', () => ({
    payoutReversed: vi.fn(() => []),
    payoutSettled: vi.fn(() => []),
    postMovement: posts.postMovement,
    refreshCachedBalances: vi.fn().mockResolvedValue(undefined),
}));

import { markPayoutFailed, markPayoutPaid, reportTransferUncertain } from './payout-transfer.js';
import { guardDecision } from '../plugins/tenant-guard.js';

function makePrisma(claimCount: number) {
    const tx: any = {
        payoutRequest: {
            updateMany: vi.fn().mockResolvedValue({ count: claimCount }),
            findUnique: vi.fn().mockResolvedValue({ tenantId: 't1', walletId: 'w1', amountMinor: 5000, currency: 'GHS' }),
        },
    };
    return { $transaction: vi.fn(async (fn: any) => fn(tx)), ...tx } as any;
}

beforeEach(() => raise.mockClear());

describe('markPayoutFailed alerting', () => {
    it('raises a critical payout.failed alert when the failure is applied', async () => {
        const prisma = makePrisma(1);
        const r = await markPayoutFailed({ prisma, payoutId: 'p1', failureReason: 'no funds' });
        expect(r.applied).toBe(true);
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'payout.failed', severity: 'critical', tenantId: 't1', dedupeKey: 'payout.failed:p1',
        }));
    });

    it('does not alert on a duplicate webhook delivery', async () => {
        const r = await markPayoutFailed({ prisma: makePrisma(0), payoutId: 'p1' });
        expect(r.applied).toBe(false);
        expect(raise).not.toHaveBeenCalled();
    });
});

describe('settling a payout from an authenticated request', () => {
    // The withdraw route calls these inside a tenant-context request. With the
    // tenant guard blocking, an unscoped query there throws inside the
    // transaction and the reversal never happens — while the owner is told
    // their money is back. Every payout query must carry the tenant.
    const guardAllows = (tx: any) => {
        const calls = [
            ...tx.payoutRequest.updateMany.mock.calls.map((c: any) => ['updateMany', c[0].where]),
            ...tx.payoutRequest.findUnique.mock.calls.map((c: any) => ['findUnique', c[0].where]),
        ];
        expect(calls.length).toBeGreaterThan(0);
        for (const [operation, where] of calls) {
            expect(guardDecision({
                model: 'PayoutRequest', operation, where, mode: 'block',
                ctx: { tenantId: 't1', userId: 'u1' }, scopedModels: new Set(['PayoutRequest']),
            })).toBe('allow');
        }
    };

    it('markPayoutFailed scopes every payout query when given a tenant', async () => {
        const prisma = makePrisma(1);
        const r = await markPayoutFailed({ prisma, payoutId: 'p1', tenantId: 't1' });
        expect(r.applied).toBe(true);
        guardAllows(prisma);
        expect(posts.postMovement).toHaveBeenCalled();
    });

    it('markPayoutPaid scopes every payout query when given a tenant', async () => {
        const prisma = makePrisma(1);
        await markPayoutPaid({ prisma, payoutId: 'p1', tenantId: 't1' });
        guardAllows(prisma);
    });
});

describe('reportTransferUncertain', () => {
    it('raises a critical payout.uncertain alert keyed on the payout', async () => {
        const prisma = {} as any;
        await reportTransferUncertain({ prisma, tenantId: 't1', payoutId: 'p9', detail: 'network_error' });
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'payout.uncertain', severity: 'critical', tenantId: 't1', dedupeKey: 'payout.uncertain:p9',
        }));
    });
});
