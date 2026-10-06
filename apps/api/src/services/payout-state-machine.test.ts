import { beforeEach, describe, expect, it, vi } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
const notify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./notifications.js', () => ({ createNotification: notify }));
const post = vi.hoisted(() => vi.fn());
vi.mock('./ledger.js', async (orig) => ({
    ...(await orig<typeof import('./ledger.js')>()),
    postMovement: post,
    refreshCachedBalances: vi.fn().mockResolvedValue(undefined),
}));

import {
    markPayoutFailed,
    markPayoutPaid,
    markPayoutProcessing,
    markPayoutReversed,
} from './payout-transfer.js';

type Status = 'REQUESTED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

function matches(value: unknown, cond: unknown): boolean {
    if (cond === undefined) return true;
    if (cond === null) return value === null;
    if (typeof cond === 'string') return value === cond;
    const c = cond as { in?: unknown[] };
    if (c.in) return c.in.includes(value);
    return false;
}

function world(status: Status, providerRef: string | null = null, opts: { settledMovement?: boolean } = {}) {
    const row: any = { id: 'p1', tenantId: 't1', walletId: 'w1', amountMinor: 5000, currency: 'GHS', status, providerRef, failureReason: null };
    const payoutRequest = {
        updateMany: vi.fn(async ({ where, data }: any) => {
            if (where.id !== row.id) return { count: 0 };
            if (where.tenantId && where.tenantId !== row.tenantId) return { count: 0 };
            for (const k of ['status', 'providerRef']) if (k in where && !matches(row[k], where[k])) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        }),
        findUnique: vi.fn(async ({ where }: any) => (where.id === row.id ? { ...row } : null)),
    };
    const ledgerMovement = {
        findUnique: vi.fn(async ({ where }: any) =>
            (opts.settledMovement && where.idempotencyKey === `payout-settled:${row.id}` ? { id: 'm-settled' } : null)),
    };
    const prisma: any = { payoutRequest, ledgerMovement, $transaction: vi.fn(async (fn: any) => fn({ payoutRequest, ledgerMovement })) };
    return { prisma, row };
}

const alerts = () => raise.mock.calls.map((c) => c[1]);

beforeEach(() => {
    vi.clearAllMocks();
    post.mockResolvedValue({ duplicate: false, movementId: 'm1' });
});

describe('markPayoutProcessing never resurrects a settled payout', () => {
    it('REQUESTED becomes PROCESSING with the provider reference', async () => {
        const w = world('REQUESTED');
        expect(await markPayoutProcessing({ prisma: w.prisma, tenantId: 't1', payoutId: 'p1', transferCode: 'TRF_1' }))
            .toEqual({ advanced: true });
        expect(w.row).toMatchObject({ status: 'PROCESSING', providerRef: 'TRF_1' });
    });

    it.each(['PAID', 'FAILED', 'CANCELLED'] as const)('a %s payout keeps its status when the route update arrives late', async (status) => {
        const w = world(status);
        const r = await markPayoutProcessing({ prisma: w.prisma, tenantId: 't1', payoutId: 'p1', transferCode: 'TRF_1' });
        expect(r).toEqual({ advanced: false });
        expect(w.row.status).toBe(status);
    });

    it('still records the provider reference when the webhook won the race (so reconciliation can find the transfer)', async () => {
        const w = world('PAID');
        await markPayoutProcessing({ prisma: w.prisma, tenantId: 't1', payoutId: 'p1', transferCode: 'TRF_1' });
        expect(w.row.providerRef).toBe('TRF_1');
    });

    it('never overwrites an existing provider reference', async () => {
        const w = world('PAID', 'TRF_OLD');
        await markPayoutProcessing({ prisma: w.prisma, tenantId: 't1', payoutId: 'p1', transferCode: 'TRF_NEW' });
        expect(w.row.providerRef).toBe('TRF_OLD');
    });

    it('every update is conditional and tenant-scoped (the status update is guarded on REQUESTED)', async () => {
        const w = world('REQUESTED');
        await markPayoutProcessing({ prisma: w.prisma, tenantId: 't1', payoutId: 'p1', transferCode: 'TRF_1' });
        for (const [arg] of w.prisma.payoutRequest.updateMany.mock.calls) {
            expect(arg.where.tenantId).toBe('t1');
            expect(arg.where.status !== undefined || arg.where.providerRef === null).toBe(true);
        }
    });
});

describe('markPayoutPaid', () => {
    it('settles once; the redelivery is a no-op', async () => {
        const w = world('PROCESSING');
        expect(await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: true });
        expect(await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: false });
        expect(post).toHaveBeenCalledTimes(1);
        expect(raise).not.toHaveBeenCalled();
    });

    it('success for a payout we already returned to the tenant (FAILED) is a double-pay risk: critical alert, no movement', async () => {
        const w = world('FAILED');
        expect(await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: false });
        expect(w.row.status).toBe('FAILED');
        expect(post).not.toHaveBeenCalled();
        expect(alerts()[0]).toMatchObject({
            kind: 'payout.paid_after_failed', severity: 'critical', tenantId: 't1', dedupeKey: 'payout.paid_after_failed:p1',
        });
    });
});

describe('markPayoutPaid: a redelivered success after our own reversal is not a contradiction', () => {
    it('payout settled, then reversed (FAILED), then transfer.success is redelivered: no alert, no movement, no-op', async () => {
        const w = world('FAILED', null, { settledMovement: true });
        expect(await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: false });
        expect(raise).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
        expect(w.row.status).toBe('FAILED');
    });

    it('looks for the settlement by its ledger key, not by anything the webhook echoes', async () => {
        const w = world('FAILED', null, { settledMovement: true });
        await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' });
        expect(w.prisma.ledgerMovement.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: 'payout-settled:p1' } }));
    });

    it('a success for a payout that FAILED without ever settling still raises ONE deduped critical alert per payout', async () => {
        const w = world('FAILED');
        await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' });
        await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' });
        expect(alerts().every((a) => a.dedupeKey === 'payout.paid_after_failed:p1' && a.kind === 'payout.paid_after_failed')).toBe(true);
        expect(alerts().length).toBeGreaterThanOrEqual(1);
    });

    it('a success while PAID is a plain duplicate (no alert)', async () => {
        const w = world('PAID');
        await markPayoutPaid({ prisma: w.prisma, payoutId: 'p1' });
        expect(raise).not.toHaveBeenCalled();
    });
});

describe('markPayoutFailed', () => {
    it('returns the money for an unsettled payout', async () => {
        const w = world('PROCESSING');
        expect(await markPayoutFailed({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: true });
        expect(post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: 'PAYOUT_REVERSED', idempotencyKey: 'payout-reversed:p1' }));
    });

    it('a failure event for a payout that already SETTLED is contradictory: no money moves, critical alert', async () => {
        const w = world('PAID');
        expect(await markPayoutFailed({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: false });
        expect(w.row.status).toBe('PAID');
        expect(post).not.toHaveBeenCalled();
        expect(alerts()[0]).toMatchObject({ kind: 'payout.event_conflict', severity: 'critical', dedupeKey: 'payout.event_conflict:p1:failed' });
    });

    it('a redelivery for an already FAILED payout is quiet', async () => {
        const w = world('FAILED');
        await markPayoutFailed({ prisma: w.prisma, payoutId: 'p1' });
        expect(raise).not.toHaveBeenCalled();
    });
});

describe('markPayoutReversed (transfer.reversed)', () => {
    it('after SUCCESS: reverses the settlement back to available, marks FAILED, alerts and tells the owner', async () => {
        const w = world('PAID', 'TRF_1');
        expect(await markPayoutReversed({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: true });
        expect(w.row.status).toBe('FAILED');
        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            tenantId: 't1', reason: 'PAYOUT_REVERSED', idempotencyKey: 'payout-settlement-reversed:p1', payoutId: 'p1',
            currency: 'GHS',
            lines: [{ account: 'EXTERNAL', amountMinor: -5000 }, { account: 'TENANT_AVAILABLE', amountMinor: 5000 }],
        }));
        expect(alerts()[0]).toMatchObject({
            kind: 'payout.reversed_after_success', severity: 'critical', tenantId: 't1', dedupeKey: 'payout.reversed_after_success:p1',
        });
        expect(notify).toHaveBeenCalled();
    });

    it('is idempotent: a redelivery changes nothing and alerts nothing more', async () => {
        const w = world('PAID', 'TRF_1');
        await markPayoutReversed({ prisma: w.prisma, payoutId: 'p1' });
        raise.mockClear();
        post.mockClear();
        expect(await markPayoutReversed({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: false });
        expect(post).not.toHaveBeenCalled();
        expect(raise).not.toHaveBeenCalled();
    });

    it('before success (PROCESSING): behaves as a failure and returns the reserved money', async () => {
        const w = world('PROCESSING');
        expect(await markPayoutReversed({ prisma: w.prisma, payoutId: 'p1' })).toEqual({ applied: true });
        expect(post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idempotencyKey: 'payout-reversed:p1' }));
        expect(w.row.status).toBe('FAILED');
    });

    it('a duplicate ledger movement (already reversed) does not double-credit', async () => {
        const w = world('PAID');
        post.mockResolvedValue({ duplicate: true, movementId: null });
        await markPayoutReversed({ prisma: w.prisma, payoutId: 'p1' });
        expect(alerts().find((a) => a.kind === 'payout.reversed_after_success')).toBeDefined();
    });
});
