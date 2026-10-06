import { beforeEach, describe, expect, it } from 'vitest';
import { rawPrisma, guardedPrisma } from './helpers/db.js';
import { ledgerSums, seedFundedWallet, seedPayoutRecipient, seedTenant, seedUser, seedWallet } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import {
    LedgerOverdrawError, deriveBalances, depositReceived, ensureWallet, fundsCleared, payoutRequested,
    payoutSettled, postMovement, refreshCachedBalances, refundIssued,
} from '../../src/services/ledger.js';
import { creditDepositToWallet } from '../../src/services/wallet-credit.js';
import { WithdrawalConflictError, WithdrawalRefusedError, createWithdrawal } from '../../src/services/payout-request.js';

describe('ledger on a real database', () => {
    let tenantId: string;
    beforeEach(async () => { tenantId = (await seedTenant()).id; });

    it('concurrent payouts on one wallet never overdraw (wallet row lock)', async () => {
        const db = rawPrisma();
        const wallet = await seedFundedWallet(tenantId, { availableMinor: 1000 });
        const { ok, failed } = await race(12, (i) =>
            db.$transaction((tx) => postMovement(tx as never, {
                tenantId, walletId: wallet.id, reason: 'PAYOUT_REQUESTED',
                idempotencyKey: `race:${i}`, lines: payoutRequested(300),
            })),
        );
        expect(ok).toHaveLength(3);
        expect(failed).toHaveLength(9);
        for (const e of failed) expect(e).toBeInstanceOf(LedgerOverdrawError);
        const b = await deriveBalances(db as never, tenantId);
        expect(b).toEqual({ availableMinor: 100, pendingMinor: 0, payoutPendingMinor: 900 });
        // The rolled-back attempts left nothing behind.
        expect(await db.ledgerMovement.count({ where: { reason: 'PAYOUT_REQUESTED' } })).toBe(3);
    });

    it('a refund and a clearing racing on the same pending money cannot both win', async () => {
        const db = rawPrisma();
        const wallet = await seedFundedWallet(tenantId, { pendingMinor: 500 });
        const { ok, failed } = await race(2, (i) =>
            db.$transaction((tx) => postMovement(tx as never, {
                tenantId, walletId: wallet.id,
                reason: i === 0 ? 'FUNDS_CLEARED' : 'REFUND_ISSUED',
                idempotencyKey: `pending-fight:${i}`,
                lines: i === 0 ? fundsCleared(500) : refundIssued(500, 0, 'TENANT_PENDING'),
            })),
        );
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(1);
        expect(failed[0]).toBeInstanceOf(LedgerOverdrawError);
        const b = await deriveBalances(db as never, tenantId);
        expect(b.pendingMinor).toBe(0);
    });

    it('rejects duplicate idempotency keys: one movement, rest reported duplicate', async () => {
        const db = rawPrisma();
        const wallet = await seedWallet(tenantId);
        const { ok, failed } = await race(8, () =>
            db.$transaction((tx) => postMovement(tx as never, {
                tenantId, walletId: wallet.id, reason: 'DEPOSIT_RECEIVED',
                idempotencyKey: 'deposit:same-ref', lines: depositReceived(1000, 0),
            })),
        );
        expect(failed).toEqual([]);
        expect(ok.filter((r) => !r.duplicate)).toHaveLength(1);
        expect(ok.filter((r) => r.duplicate)).toHaveLength(7);
        expect(await db.ledgerMovement.count({ where: { idempotencyKey: 'deposit:same-ref' } })).toBe(1);
        expect(await db.ledgerEntry.count({ where: { tenantId } })).toBe(2);
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(1000);
    });

    it('sequential duplicate key is a no-op too', async () => {
        const db = rawPrisma();
        const wallet = await seedWallet(tenantId);
        const post = () => db.$transaction((tx) => postMovement(tx as never, {
            tenantId, walletId: wallet.id, reason: 'DEPOSIT_RECEIVED', idempotencyKey: 'k1', lines: depositReceived(700, 0),
        }));
        expect((await post()).duplicate).toBe(false);
        expect((await post()).duplicate).toBe(true);
        expect(await db.ledgerEntry.count({ where: { tenantId } })).toBe(2);
    });

    it('derives balances from the log and every movement sums to zero', async () => {
        const db = rawPrisma();
        const wallet = await seedWallet(tenantId);
        const run = (key: string, reason: any, lines: any) =>
            db.$transaction((tx) => postMovement(tx as never, { tenantId, walletId: wallet.id, reason, idempotencyKey: key, lines }));
        await run('d1', 'DEPOSIT_RECEIVED', depositReceived(10_000, 250));   // pending 9750, fee 250
        await run('c1', 'FUNDS_CLEARED', fundsCleared(9_000));                // pending 750, available 9000
        await run('p1', 'PAYOUT_REQUESTED', payoutRequested(4_000));          // available 5000, payout 4000
        await run('s1', 'PAYOUT_SETTLED', payoutSettled(1_500));              // payout 2500
        expect(await deriveBalances(db as never, tenantId)).toEqual({
            availableMinor: 5000, pendingMinor: 750, payoutPendingMinor: 2500,
        });
        const movements = await db.ledgerMovement.findMany({ where: { tenantId }, include: { entries: true } });
        expect(movements).toHaveLength(4);
        for (const m of movements) expect(m.entries.reduce((t, e) => t + e.amountMinor, 0)).toBe(0);
        const all = await db.ledgerEntry.aggregate({ where: { tenantId }, _sum: { amountMinor: true } });
        expect(all._sum.amountMinor).toBe(0);
        const sums = await ledgerSums(tenantId);
        expect(sums.PLATFORM_FEE).toBe(250);
        expect(sums.EXTERNAL).toBe(-10_000 + 1_500);

        const cached = await db.$transaction((tx) => refreshCachedBalances(tx as never, tenantId, wallet.id));
        expect(cached.availableMinor).toBe(5000);
        const w = await db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        expect(w.cachedAvailableMinor).toBe(5000);
        expect(w.cachedPendingMinor).toBe(750);
        expect(w.lastReconciledAt).not.toBeNull();
    });

    it('a failed movement rolls back its rows (overdraw leaves no entries)', async () => {
        const db = rawPrisma();
        const wallet = await seedWallet(tenantId);
        await expect(db.$transaction((tx) => postMovement(tx as never, {
            tenantId, walletId: wallet.id, reason: 'PAYOUT_REQUESTED', idempotencyKey: 'x', lines: payoutRequested(100),
        }))).rejects.toBeInstanceOf(LedgerOverdrawError);
        expect(await db.ledgerMovement.count()).toBe(0);
        expect(await db.ledgerEntry.count()).toBe(0);
    });

    it('two first-ever payments landing together never create two wallets or double-credit (invariant)', async () => {
        const prisma = await guardedPrisma();
        const { ok } = await race(2, (i) => creditDepositToWallet({
            prisma, tenantId, grossMinor: 5000, currency: 'GHS', reference: `first-${i}`, storedRoute: 'PLATFORM',
        }));
        expect(await rawPrisma().wallet.count({ where: { tenantId } })).toBe(1);
        // Whatever was credited is exactly what the ledger holds.
        expect((await ledgerSums(tenantId)).TENANT_PENDING ?? 0).toBe(ok.filter((r) => r.credited).length * 5000);
        expect(ok.length).toBeGreaterThanOrEqual(1);
    });

    // BUG (reported, not fixed here): ledger.ts ensureWallet catches the
    // P2002 from the losing wallet INSERT and then queries on the same
    // transaction, which Postgres has aborted (25P02). The loser's whole credit
    // throws; creditForPlatformPayment logs "replay this reference" and the
    // customer's money stays uncredited until someone replays it.
    // keeps the suite green while the bug exists and turns red when it is fixed
    // (flip it to a plain `it` then).
    it('BUG: two first-ever payments landing together BOTH credit (ensureWallet race aborts the loser)', async () => {
        const prisma = await guardedPrisma();
        const { ok, failed } = await race(2, (i) => creditDepositToWallet({
            prisma, tenantId, grossMinor: 5000, currency: 'GHS', reference: `first-${i}`, storedRoute: 'PLATFORM',
        }));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(ok.every((r) => r.credited)).toBe(true);
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(10_000);
    });

    it('ensureWallet concurrently leaves exactly one wallet', async () => {
        const prisma = await guardedPrisma();
        await race(6, () => ensureWallet(prisma, tenantId, 'GHS'));
        expect(await rawPrisma().wallet.count({ where: { tenantId } })).toBe(1);
    });

    it('BUG: concurrent ensureWallet callers all get the wallet back (same 25P02 abort)', async () => {
        const prisma = await guardedPrisma();
        const { ok, failed } = await race(6, () => ensureWallet(prisma, tenantId, 'GHS'));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(new Set(ok.map((w) => w.id)).size).toBe(1);
    });

    it('creditDepositToWallet is idempotent per reference under concurrency', async () => {
        const prisma = await guardedPrisma();
        await seedWallet(tenantId);
        const { ok, failed } = await race(6, () => creditDepositToWallet({
            prisma, tenantId, grossMinor: 5000, currency: 'GHS', reference: 'dup-ref', storedRoute: 'PLATFORM',
        }));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(ok.filter((r) => r.credited)).toHaveLength(1);
        expect(ok.filter((r) => r.skippedReason === 'already_credited')).toHaveLength(5);
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(5000);
    });
});

describe('createWithdrawal on a real database (serializable)', () => {
    let tenantId: string; let userId: string;
    beforeEach(async () => {
        tenantId = (await seedTenant()).id;
        userId = (await seedUser(tenantId)).id;
        await seedPayoutRecipient(tenantId);
    });

    it('two simultaneous withdrawals exceeding the balance: exactly one succeeds', async () => {
        const prisma = await guardedPrisma();
        await seedFundedWallet(tenantId, { availableMinor: 1000 });
        const { ok, failed } = await race(2, () =>
            createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 800 }));
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(1);
        const db = rawPrisma();
        expect(await db.payoutRequest.count({ where: { tenantId } })).toBe(1);
        expect(await deriveBalances(db as never, tenantId)).toEqual({ availableMinor: 200, pendingMinor: 0, payoutPendingMinor: 800 });
        const w = await db.wallet.findUniqueOrThrow({ where: { tenantId } });
        expect(w.cachedAvailableMinor).toBe(200);
    });

    it('many simultaneous affordable withdrawals: only one payout in flight (one-at-a-time rule)', async () => {
        const prisma = await guardedPrisma();
        await seedFundedWallet(tenantId, { availableMinor: 100_000 });
        const { ok } = await race(8, () =>
            createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 1000 }));
        expect(ok).toHaveLength(1);
        expect(await rawPrisma().payoutRequest.count({ where: { tenantId } })).toBe(1);
        expect((await deriveBalances(rawPrisma() as never, tenantId)).availableMinor).toBe(99_000);
    });

    // BUG (reported, not fixed here): under contention Postgres reports
    // `40P01 deadlock detected` from lockWallet's raw FOR UPDATE, which Prisma
    // surfaces as P2010 with meta.code '40P01'. payout-request.ts
    // isSerializationFailure only recognises err.code '40001' / 'P2034', so the
    // losers get a raw PrismaClientKnownRequestError (a 500) instead of
    // WithdrawalConflictError. Money is safe (the invariant test above holds).
    it('BUG: losing concurrent withdrawals fail with a refusal/conflict, never a raw database error', async () => {
        const prisma = await guardedPrisma();
        await seedFundedWallet(tenantId, { availableMinor: 100_000 });
        const { failed } = await race(8, () =>
            createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 1000 }));
        for (const e of failed) {
            expect(e instanceof WithdrawalRefusedError || e instanceof WithdrawalConflictError, String(e?.message).slice(0, 120)).toBe(true);
        }
    });

    it('repeated rounds stay safe (no round ever lets both through)', async () => {
        const prisma = await guardedPrisma();
        const db = rawPrisma();
        for (let round = 0; round < 5; round++) {
            await db.payoutRequest.deleteMany({});
            await db.ledgerEntry.deleteMany({});
            await db.ledgerMovement.deleteMany({});
            await db.wallet.deleteMany({});
            await seedFundedWallet(tenantId, { availableMinor: 1000 });
            const { ok } = await race(3, () => createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 700 }));
            expect(ok, `round ${round}`).toHaveLength(1);
            expect((await deriveBalances(db as never, tenantId)).availableMinor, `round ${round}`).toBe(300);
        }
    });

    it('refuses with insufficient_funds and writes nothing', async () => {
        const prisma = await guardedPrisma();
        await seedFundedWallet(tenantId, { availableMinor: 500 });
        await expect(createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 900 }))
            .rejects.toMatchObject({ reason: 'insufficient_funds' });
        expect(await rawPrisma().payoutRequest.count()).toBe(0);
    });

    it('PAYOUT_REQUESTED movement is keyed on the payout id', async () => {
        const prisma = await guardedPrisma();
        await seedFundedWallet(tenantId, { availableMinor: 5000 });
        const r = await createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 2000 });
        const mv = await rawPrisma().ledgerMovement.findFirstOrThrow({ where: { payoutId: r.payoutId } });
        expect(mv.idempotencyKey).toBe(`payout:${r.payoutId}`);
        expect(mv.reason).toBe('PAYOUT_REQUESTED');
    });
});
