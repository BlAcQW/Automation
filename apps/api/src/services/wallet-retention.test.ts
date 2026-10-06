import { describe, expect, it, vi } from 'vitest';
import { tenantDeletionBlockers } from './wallet-retention.js';

function makePrisma(over: { entries?: number; inFlight?: number; wallet?: boolean } = {}) {
    return {
        wallet: { findUnique: vi.fn(async () => (over.wallet === false ? null : { id: 'w1' })) },
        ledgerEntry: { count: vi.fn(async () => over.entries ?? 0) },
        payoutRequest: { count: vi.fn(async () => over.inFlight ?? 0) },
    } as any;
}

describe('tenantDeletionBlockers', () => {
    it('a tenant that never handled money may be deleted', async () => {
        expect(await tenantDeletionBlockers(makePrisma({ wallet: false }), 't1')).toEqual([]);
        expect(await tenantDeletionBlockers(makePrisma(), 't1')).toEqual([]);
    });

    it('any ledger history blocks deletion (the wallet FK cascades the books away with the tenant)', async () => {
        const blockers = await tenantDeletionBlockers(makePrisma({ entries: 3 }), 't1');
        expect(blockers).toHaveLength(1);
        expect(blockers[0]).toMatch(/ledger/i);
    });

    it('an in-flight payout blocks deletion', async () => {
        const blockers = await tenantDeletionBlockers(makePrisma({ inFlight: 1 }), 't1');
        expect(blockers.join(' ')).toMatch(/payout/i);
    });

    it('reports every reason at once', async () => {
        expect(await tenantDeletionBlockers(makePrisma({ entries: 3, inFlight: 2 }), 't1')).toHaveLength(2);
    });

    it('every query is scoped to the tenant', async () => {
        const prisma = makePrisma({ entries: 1, inFlight: 1 });
        await tenantDeletionBlockers(prisma, 't1');
        expect(prisma.wallet.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1' } }));
        expect(prisma.ledgerEntry.count).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
        expect(prisma.payoutRequest.count.mock.calls[0][0].where.tenantId).toBe('t1');
    });
});
