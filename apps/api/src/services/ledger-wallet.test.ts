import { beforeEach, describe, expect, it, vi } from 'vitest';

const errorLog = vi.hoisted(() => vi.fn());
vi.mock('../lib/logger.js', () => ({
    scoped: () => ({ error: errorLog, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    logger: {},
}));

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));

import { ensureWallet, readWalletCurrency } from './ledger.js';

function makeTx(opts: { wallet?: { id: string; currency: string } | null; tenantCurrency?: string | null }) {
    return {
        wallet: {
            findUnique: vi.fn().mockResolvedValue(opts.wallet ?? null),
            upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: 'w_new', currency: create.currency })),
        },
        tenant: {
            findUnique: vi.fn().mockResolvedValue(
                opts.tenantCurrency === null ? null : { paymentCurrency: opts.tenantCurrency ?? 'NGN' },
            ),
        },
    } as any;
}

beforeEach(() => { errorLog.mockClear(); raise.mockClear(); });

describe('ensureWallet', () => {
    it('returns the existing wallet without creating one', async () => {
        const tx = makeTx({ wallet: { id: 'w1', currency: 'GHS' } });
        const w = await ensureWallet(tx, 't1', 'GHS');
        expect(w).toEqual({ id: 'w1', currency: 'GHS' });
        expect(tx.wallet.upsert).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
    });

    it('creates with the explicitly requested currency', async () => {
        const tx = makeTx({});
        const w = await ensureWallet(tx, 't1', 'KES');
        expect(w.currency).toBe('KES');
        expect(tx.wallet.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ create: { tenantId: 't1', currency: 'KES' } }),
        );
    });

    it("defaults a new wallet to the tenant's paymentCurrency, not GHS", async () => {
        const tx = makeTx({ tenantCurrency: 'NGN' });
        const w = await ensureWallet(tx, 't1');
        expect(w.currency).toBe('NGN');
    });

    it('raises a critical alert on a currency mismatch, none otherwise', async () => {
        const mismatch = makeTx({ wallet: { id: 'w1', currency: 'GHS' } });
        await ensureWallet(mismatch, 't1', 'NGN');
        expect(raise).toHaveBeenCalledWith(mismatch, expect.objectContaining({
            kind: 'wallet.currency_mismatch',
            severity: 'critical',
            tenantId: 't1',
            dedupeKey: 'wallet.currency_mismatch:t1:NGN',
        }));
        raise.mockClear();
        await ensureWallet(makeTx({ wallet: { id: 'w1', currency: 'GHS' } }), 't1', 'GHS');
        expect(raise).not.toHaveBeenCalled();
    });

    it('logs at error and keeps the existing currency on a mismatch', async () => {
        const tx = makeTx({ wallet: { id: 'w1', currency: 'GHS' } });
        const w = await ensureWallet(tx, 't1', 'NGN');
        expect(w).toEqual({ id: 'w1', currency: 'GHS' });
        expect(tx.wallet.upsert).not.toHaveBeenCalled();
        expect(errorLog).toHaveBeenCalledTimes(1);
        expect(errorLog.mock.calls[0][0]).toMatchObject({
            tenantId: 't1',
            walletCurrency: 'GHS',
            requestedCurrency: 'NGN',
        });
    });

    it('does not consult the tenant when no currency is requested and wallet exists', async () => {
        const tx = makeTx({ wallet: { id: 'w1', currency: 'GHS' } });
        await ensureWallet(tx, 't1');
        expect(tx.tenant.findUnique).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
    });
});

describe('readWalletCurrency (read path)', () => {
    it('never creates a wallet and reports the tenant currency when none exists', async () => {
        const tx = makeTx({ tenantCurrency: 'NGN' });
        const r = await readWalletCurrency(tx, 't1');
        expect(r).toEqual({ walletExists: false, currency: 'NGN' });
        expect(tx.wallet.upsert).not.toHaveBeenCalled();
    });

    it('uses the wallet currency when it exists', async () => {
        const tx = makeTx({ wallet: { id: 'w1', currency: 'GHS' }, tenantCurrency: 'NGN' });
        expect(await readWalletCurrency(tx, 't1')).toEqual({ walletExists: true, currency: 'GHS' });
    });

    it('falls back to GHS when neither wallet nor tenant is found', async () => {
        const tx = makeTx({ tenantCurrency: null });
        expect(await readWalletCurrency(tx, 't1')).toEqual({ walletExists: false, currency: 'GHS' });
    });
});
