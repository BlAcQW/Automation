import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({
    scoped: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    logger: {},
}));
const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));

import {
    DEFAULT_PAYMENT_CURRENCY,
    LedgerCurrencyMismatchError,
    deriveBalances,
    ensureWallet,
    payoutSettlementReversed,
    postMovement,
    refreshCachedBalances,
    reportCurrencyMismatch,
    assertBalanced,
    depositReceived,
} from './ledger.js';

type Entry = { account: string; amountMinor: number; currency: string };

/** A tiny in-memory stand-in for the slice of Prisma the ledger touches. */
function makeTx(opts: {
    walletCurrency?: string | null;
    entries?: Entry[];
    existingKeys?: string[];
    createError?: unknown;
}) {
    const entries = [...(opts.entries ?? [])];
    const wallet = opts.walletCurrency === null ? null : { id: 'w1', currency: opts.walletCurrency ?? 'GHS' };
    const tx: any = {
        $queryRawUnsafe: vi.fn(async () => []),
        wallet: {
            findFirst: vi.fn(async () => wallet),
            findUnique: vi.fn(async () => wallet),
            update: vi.fn(async () => ({})),
            upsert: vi.fn(async ({ create }: any) => ({ id: 'w_new', currency: create.currency })),
            create: vi.fn(),
        },
        tenant: { findUnique: vi.fn(async () => ({ paymentCurrency: 'GHS' })) },
        ledgerMovement: {
            findFirst: vi.fn(async ({ where }: any) =>
                (opts.existingKeys ?? []).includes(where.idempotencyKey) ? { id: 'm_old' } : null),
            create: vi.fn(async ({ data }: any) => {
                if (opts.createError) throw opts.createError;
                for (const e of data.entries.create) entries.push({ account: e.account, amountMinor: e.amountMinor, currency: e.currency });
                return { id: 'm_new' };
            }),
        },
        ledgerEntry: {
            findMany: vi.fn(async ({ where }: any) =>
                entries.filter((e) => (where.currency ? e.currency === where.currency : true))),
        },
    };
    return tx;
}

beforeEach(() => raise.mockClear());

describe('single currency source', () => {
    it('defaults to GHS', () => {
        expect(DEFAULT_PAYMENT_CURRENCY).toBe('GHS');
    });
});

describe('postMovement currency assertion', () => {
    const base = {
        tenantId: 't1', walletId: 'w1', reason: 'DEPOSIT_RECEIVED' as const,
        idempotencyKey: 'deposit:r1', lines: depositReceived(5000, 0),
    };

    it('rejects a movement whose currency differs from the wallet and writes nothing', async () => {
        const tx = makeTx({ walletCurrency: 'GHS' });
        await expect(postMovement(tx, { ...base, currency: 'NGN' })).rejects.toBeInstanceOf(LedgerCurrencyMismatchError);
        expect(tx.ledgerMovement.create).not.toHaveBeenCalled();
    });

    it('carries the facts needed to alert on the error', async () => {
        const tx = makeTx({ walletCurrency: 'GHS' });
        const err = await postMovement(tx, { ...base, currency: 'USD' }).catch((e) => e);
        expect(err).toMatchObject({ tenantId: 't1', walletCurrency: 'GHS', movementCurrency: 'USD', idempotencyKey: 'deposit:r1' });
    });

    it('takes the wallet currency when none is given (never a hardcoded default)', async () => {
        const tx = makeTx({ walletCurrency: 'NGN' });
        await postMovement(tx, base);
        const data = tx.ledgerMovement.create.mock.calls[0][0].data;
        expect(data.currency).toBe('NGN');
        expect(data.entries.create.every((e: any) => e.currency === 'NGN')).toBe(true);
    });

    it('accepts a matching currency', async () => {
        const tx = makeTx({ walletCurrency: 'GHS' });
        expect(await postMovement(tx, { ...base, currency: 'GHS' })).toEqual({ movementId: 'm_new', duplicate: false });
    });

    it('refuses a wallet that does not belong to the tenant', async () => {
        const tx = makeTx({ walletCurrency: null });
        await expect(postMovement(tx, base)).rejects.toThrow(/wallet/i);
        expect(tx.wallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'w1', tenantId: 't1' },
        }));
        expect(tx.ledgerMovement.create).not.toHaveBeenCalled();
    });

    it('checks overdraw against the wallet currency only', async () => {
        // A stray NGN entry must neither mask nor cause an overdraw in GHS.
        const tx = makeTx({ walletCurrency: 'GHS', entries: [{ account: 'TENANT_PENDING', amountMinor: -9999, currency: 'NGN' }] });
        await expect(postMovement(tx, base)).resolves.toMatchObject({ duplicate: false });
    });
});

describe('postMovement idempotency without aborting the transaction', () => {
    const args = {
        tenantId: 't1', walletId: 'w1', reason: 'DEPOSIT_RECEIVED' as const,
        idempotencyKey: 'deposit:r1', lines: depositReceived(5000, 0),
    };

    it('a repeated key is a duplicate found BEFORE the insert (no failing statement inside the transaction)', async () => {
        const tx = makeTx({ existingKeys: ['deposit:r1'] });
        expect(await postMovement(tx, args)).toEqual({ movementId: null, duplicate: true });
        expect(tx.ledgerMovement.create).not.toHaveBeenCalled();
    });

    it('looks the key up inside the wallet lock and scoped to the tenant', async () => {
        const tx = makeTx({});
        await postMovement(tx, args);
        const lockOrder = tx.$queryRawUnsafe.mock.invocationCallOrder[0];
        const lookupOrder = tx.ledgerMovement.findFirst.mock.invocationCallOrder[0];
        expect(lockOrder).toBeLessThan(lookupOrder);
        expect(tx.ledgerMovement.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { idempotencyKey: 'deposit:r1', tenantId: 't1' },
        }));
    });

    it('a unique violation that still gets through (key held by ANOTHER tenant) is loud, not a silent skip', async () => {
        const tx = makeTx({ createError: Object.assign(new Error('unique'), { code: 'P2002' }) });
        await expect(postMovement(tx, args)).rejects.toThrow(/unique/);
    });
});

describe('deriveBalances', () => {
    const entries: Entry[] = [
        { account: 'TENANT_AVAILABLE', amountMinor: 1000, currency: 'GHS' },
        { account: 'TENANT_AVAILABLE', amountMinor: 777, currency: 'NGN' },
        { account: 'TENANT_PENDING', amountMinor: 500, currency: 'GHS' },
        { account: 'PAYOUT_PENDING', amountMinor: 200, currency: 'GHS' },
    ];

    it('sums only the given currency', async () => {
        const tx = makeTx({ entries });
        expect(await deriveBalances(tx, 't1', 'GHS')).toEqual({ availableMinor: 1000, pendingMinor: 500, payoutPendingMinor: 200 });
        expect(await deriveBalances(tx, 't1', 'NGN')).toEqual({ availableMinor: 777, pendingMinor: 0, payoutPendingMinor: 0 });
    });

    it('defaults to the wallet currency', async () => {
        const tx = makeTx({ entries, walletCurrency: 'GHS' });
        expect((await deriveBalances(tx, 't1')).availableMinor).toBe(1000);
    });

    it('is all zeros with no wallet and no currency (nothing to sum)', async () => {
        const tx = makeTx({ entries, walletCurrency: null });
        expect(await deriveBalances(tx, 't1')).toEqual({ availableMinor: 0, pendingMinor: 0, payoutPendingMinor: 0 });
        expect(tx.ledgerEntry.findMany).not.toHaveBeenCalled();
    });

    it('refreshCachedBalances caches the wallet-currency figure', async () => {
        const tx = makeTx({ entries, walletCurrency: 'GHS' });
        await refreshCachedBalances(tx, 't1', 'w1');
        expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ cachedAvailableMinor: 1000, cachedPendingMinor: 500 }),
        }));
    });
});

describe('ensureWallet without a failing insert inside the transaction', () => {
    it('creates through an upsert so two first payments cannot abort each other', async () => {
        const tx = makeTx({ walletCurrency: null });
        const w = await ensureWallet(tx, 't1', 'GHS');
        expect(w).toEqual({ id: 'w_new', currency: 'GHS' });
        expect(tx.wallet.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 't1' }, create: { tenantId: 't1', currency: 'GHS' },
        }));
        // The update must NOT be empty: Prisma only emits an atomic INSERT ...
        // ON CONFLICT for a non-empty update (proven by the real-DB suite).
        const update = tx.wallet.upsert.mock.calls[0][0].update;
        expect(Object.keys(update).length).toBeGreaterThan(0);
        expect(tx.wallet.create).not.toHaveBeenCalled();
    });

    it('an upsert that lost the race returns the winner (currency kept, mismatch alerted)', async () => {
        const tx = makeTx({ walletCurrency: null });
        tx.wallet.upsert = vi.fn(async () => ({ id: 'w_winner', currency: 'GHS' }));
        const w = await ensureWallet(tx, 't1', 'NGN');
        expect(w).toEqual({ id: 'w_winner', currency: 'GHS' });
        expect(raise).toHaveBeenCalledWith(tx, expect.objectContaining({ kind: 'wallet.currency_mismatch', severity: 'critical' }));
    });
});

describe('settlement reversal movement', () => {
    it('gives the money back to AVAILABLE out of EXTERNAL and balances', () => {
        const lines = payoutSettlementReversed(4900);
        expect(lines).toEqual([
            { account: 'EXTERNAL', amountMinor: -4900 },
            { account: 'TENANT_AVAILABLE', amountMinor: 4900 },
        ]);
        expect(() => assertBalanced(lines)).not.toThrow();
    });
});

describe('reportCurrencyMismatch', () => {
    it('raises a critical alert from OUTSIDE the failed transaction', async () => {
        const prisma = {} as any;
        await reportCurrencyMismatch(prisma, new LedgerCurrencyMismatchError('t1', 'GHS', 'NGN', 'deposit:r1'));
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'ledger.currency_mismatch', severity: 'critical', tenantId: 't1',
            dedupeKey: 'ledger.currency_mismatch:t1:deposit:r1',
            context: expect.objectContaining({ walletCurrency: 'GHS', movementCurrency: 'NGN' }),
        }));
    });
});
