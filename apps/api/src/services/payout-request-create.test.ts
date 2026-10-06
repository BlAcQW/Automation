import { beforeEach, describe, expect, it, vi } from 'vitest';

const posts = vi.hoisted(() => ({
    postMovement: vi.fn(async () => ({ duplicate: false, movementId: 'm1' })),
    deriveBalances: vi.fn(async () => ({ availableMinor: 10_000, pendingMinor: 0, payoutPendingMinor: 0 })),
    refreshCachedBalances: vi.fn(async () => undefined),
}));
vi.mock('./ledger.js', async (orig) => ({ ...(await orig<typeof import('./ledger.js')>()), ...posts }));
const paused = vi.hoisted(() => vi.fn());
vi.mock('./platform-switches.js', () => ({ isPayoutsPaused: paused }));
const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));

import { LedgerCurrencyMismatchError } from './ledger.js';
import {
    WithdrawalRefusedError,
    createWithdrawal,
    refusalMessage,
} from './payout-request.js';

const NOW = new Date('2026-10-07T15:00:00Z');
const HOUR = 3600_000;

const goodDestination = {
    id: 'rcp_1', providerCode: 'RCP_code_1', usableFrom: new Date(NOW.getTime() - 48 * HOUR), archivedAt: null,
};

function makePrisma(over: { destination?: unknown; payouts?: unknown[]; walletCurrency?: string } = {}) {
    const tx: any = {
        wallet: { findUnique: vi.fn(async () => ({ id: 'w1', currency: over.walletCurrency ?? 'GHS' })) },
        payoutRecipient: { findFirst: vi.fn(async () => ('destination' in over ? over.destination : goodDestination)) },
        payoutRequest: {
            findMany: vi.fn(async () => over.payouts ?? []),
            count: vi.fn(async () => 0),
            create: vi.fn(async () => ({ id: 'po_1' })),
        },
    };
    const prisma: any = { $transaction: vi.fn(async (fn: any) => fn(tx)), tx };
    return prisma;
}

const run = (prisma: any, over: Record<string, unknown> = {}) =>
    createWithdrawal({ prisma, tenantId: 't1', requestedByUserId: 'u1', amountMinor: 5000, now: NOW, ...over });

beforeEach(() => {
    vi.clearAllMocks();
    paused.mockResolvedValue({ paused: false });
    posts.deriveBalances.mockResolvedValue({ availableMinor: 10_000, pendingMinor: 0, payoutPendingMinor: 0 });
});

describe('payout switch', () => {
    it('refuses with a clear owner-facing message, opens no transaction, and does not leak the internal reason', async () => {
        paused.mockResolvedValue({ paused: true, reason: 'fraud review of tenant, ticket 4411' });
        const prisma = makePrisma();
        const err: any = await run(prisma).catch((e) => e);
        expect(err).toBeInstanceOf(WithdrawalRefusedError);
        expect(err.reason).toBe('payouts_paused');
        expect(err.message).toMatch(/paused/i);
        expect(err.message).toMatch(/safe/i);
        expect(err.message).not.toMatch(/fraud|4411/);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(paused).toHaveBeenCalledWith(prisma, 't1');
    });

    it('fails CLOSED when the switch cannot be read (paying out while unsure is the wrong failure)', async () => {
        paused.mockRejectedValue(new Error('db down'));
        const prisma = makePrisma();
        const err: any = await run(prisma).catch((e) => e);
        expect(err).toBeInstanceOf(WithdrawalRefusedError);
        expect(err.reason).toBe('payouts_paused');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('proceeds when not paused', async () => {
        expect(await run(makePrisma())).toMatchObject({ payoutId: 'po_1' });
    });

    it('has a message for the reason', () => {
        expect(refusalMessage('payouts_paused')).toMatch(/paused/i);
    });
});

describe('the recipient is snapshotted at request time', () => {
    it('stores the validated recipient on the payout and returns exactly that recipient code', async () => {
        const prisma = makePrisma();
        const r = await run(prisma);
        expect(prisma.tx.payoutRequest.create.mock.calls[0][0].data).toMatchObject({ recipientId: 'rcp_1' });
        expect(r).toMatchObject({ payoutId: 'po_1', recipientId: 'rcp_1', recipientCode: 'RCP_code_1' });
    });

    it('a destination Paystack never gave a code for cannot be paid', async () => {
        const prisma = makePrisma({ destination: { ...goodDestination, providerCode: null } });
        const err: any = await run(prisma).catch((e) => e);
        expect(err).toBeInstanceOf(WithdrawalRefusedError);
        expect(err.reason).toBe('destination_not_ready');
        expect(prisma.tx.payoutRequest.create).not.toHaveBeenCalled();
    });

    it('a destination still cooling off cannot be paid', async () => {
        const prisma = makePrisma({ destination: { ...goodDestination, usableFrom: new Date(NOW.getTime() + HOUR) } });
        const err: any = await run(prisma).catch((e) => e);
        expect(err.reason).toBe('destination_not_ready');
    });
});

describe('daily limits are a rolling 24 hours, not a calendar day', () => {
    it('looks back exactly 24 hours from now', async () => {
        const prisma = makePrisma();
        await run(prisma);
        const where = prisma.tx.payoutRequest.findMany.mock.calls[0][0].where;
        expect(where.tenantId).toBe('t1');
        expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 24 * HOUR));
    });

    it('a withdrawal made 23 hours ago (just before midnight) still counts against the cap', async () => {
        posts.deriveBalances.mockResolvedValue({ availableMinor: 900_000, pendingMinor: 0, payoutPendingMinor: 0 });
        const prisma = makePrisma({
            payouts: [{ amountMinor: 450_000, status: 'PAID', createdAt: new Date(NOW.getTime() - 23 * HOUR) }],
        });
        const err: any = await run(prisma, { amountMinor: 100_000 }).catch((e) => e);
        expect(err).toBeInstanceOf(WithdrawalRefusedError);
        expect(err.reason).toBe('daily_limit_reached');
    });

    it('messages speak of 24 hours, not "today" or "tomorrow"', () => {
        for (const reason of ['daily_count_reached', 'daily_limit_reached'] as const) {
            const m = refusalMessage(reason);
            expect(m).toMatch(/24 hours/);
            expect(m).not.toMatch(/tomorrow|today/i);
        }
    });
});

describe('payouts are in the wallet currency only', () => {
    it('derives balances, stores the payout and posts the movement in the wallet currency', async () => {
        const prisma = makePrisma({ walletCurrency: 'NGN' });
        const r = await run(prisma);
        expect(posts.deriveBalances).toHaveBeenCalledWith(expect.anything(), 't1', 'NGN');
        expect(prisma.tx.payoutRequest.create.mock.calls[0][0].data.currency).toBe('NGN');
        expect(posts.postMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ currency: 'NGN' }));
        expect(r.currency).toBe('NGN');
    });

    it('a currency mismatch from the ledger is alerted from outside the rolled-back transaction', async () => {
        posts.postMovement.mockRejectedValueOnce(new LedgerCurrencyMismatchError('t1', 'GHS', 'NGN', 'payout:po_1'));
        const prisma = makePrisma();
        await expect(run(prisma)).rejects.toBeInstanceOf(LedgerCurrencyMismatchError);
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'ledger.currency_mismatch', severity: 'critical' }));
    });
});
