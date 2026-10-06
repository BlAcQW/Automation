import { beforeEach, describe, expect, it, vi } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
vi.mock('./ledger.js', async (orig) => ({
    ...(await orig<typeof import('./ledger.js')>()),
    ensureWallet: vi.fn(async () => ({ id: 'w1', currency: 'GHS' })),
    postMovement: vi.fn(),
    refreshCachedBalances: vi.fn(),
}));

import { LedgerCurrencyMismatchError, postMovement } from './ledger.js';
import { creditDepositToWallet } from './wallet-credit.js';

const post = postMovement as unknown as ReturnType<typeof vi.fn>;
const prisma: any = { $transaction: vi.fn(async (fn: any) => fn({})) };
const args = {
    prisma, tenantId: 't1', grossMinor: 5000, currency: 'NGN', reference: 'ref1', storedRoute: 'PLATFORM',
};

beforeEach(() => { raise.mockClear(); post.mockReset(); });

describe('creditDepositToWallet currency', () => {
    it('does not credit a charge in another currency, and alerts from the root client', async () => {
        post.mockRejectedValue(new LedgerCurrencyMismatchError('t1', 'GHS', 'NGN', 'deposit:ref1'));
        const r = await creditDepositToWallet(args);
        expect(r).toEqual({ credited: false, skippedReason: 'currency_mismatch' });
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'ledger.currency_mismatch', severity: 'critical', tenantId: 't1',
        }));
    });

    it('lets any other failure through so the caller can see the credit failed', async () => {
        post.mockRejectedValue(new Error('db down'));
        await expect(creditDepositToWallet(args)).rejects.toThrow('db down');
        expect(raise).not.toHaveBeenCalled();
    });

    it('credits normally when the currencies agree', async () => {
        post.mockResolvedValue({ movementId: 'm1', duplicate: false });
        const r = await creditDepositToWallet({ ...args, currency: 'GHS' });
        expect(r).toMatchObject({ credited: true, netMinor: 5000 });
    });
});
