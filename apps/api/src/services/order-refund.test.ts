import { describe, it, expect, vi, beforeEach } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
const refund = vi.hoisted(() => vi.fn());
vi.mock('./paystack.js', () => ({ refundTransaction: refund }));
const cfg = vi.hoisted(() => ({ platformPaystack: { secretKey: 'sk_platform' } as { secretKey: string } | null }));
vi.mock('../config/index.js', () => ({ config: cfg }));
vi.mock('./ledger.js', () => ({
    postMovement: vi.fn(async () => ({ duplicate: false })),
    refreshCachedBalances: vi.fn(),
    refundIssued: vi.fn(() => []),
}));
const pending = vi.hoisted(() => vi.fn(() => 5000));
vi.mock('./wallet-clearing.js', () => ({ pendingFromEntries: pending }));

import { postMovement, refundIssued } from './ledger.js';
import { refundOrderPayment } from './order-refund.js';

const post = postMovement as unknown as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-10-07T10:00:00Z');

function makePrisma(over: { order?: Record<string, unknown> | null; claim?: number; movements?: unknown[] } = {}) {
    return {
        order: {
            findFirst: vi.fn().mockResolvedValue(over.order === null ? null : {
                status: 'CANCELLED', paymentStatus: 'PAID', paymentReference: 'ref1', collectionRoute: 'PLATFORM', ...over.order,
            }),
            updateMany: vi.fn().mockResolvedValue({ count: over.claim ?? 1 }),
        },
        ledgerMovement: {
            findMany: vi.fn().mockResolvedValue(over.movements ?? [{ entries: [{ account: 'TENANT_PENDING', amountMinor: 5000 }] }]),
        },
        $transaction: vi.fn(async (fn: any) => fn({ wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', currency: 'GHS' }) } })),
    } as any;
}
const run = (prisma: any, extra: Record<string, unknown> = {}) =>
    refundOrderPayment({ prisma, tenantId: 't1', orderId: 'o1', now: NOW, ...extra });
const updates = (prisma: any) => prisma.order.updateMany.mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
    raise.mockClear();
    refund.mockReset();
    refund.mockResolvedValue({ id: 'r1', status: 'pending', amountKobo: 5000, currency: 'GHS' });
    post.mockClear();
    post.mockResolvedValue({ duplicate: false });
    (refundIssued as any).mockClear();
    pending.mockReturnValue(5000);
    cfg.platformPaystack = { secretKey: 'sk_platform' };
});

describe('refundOrderPayment', () => {
    it('refunds a paid cancelled order with the platform key on the STORED route and posts refund:order:<id>', async () => {
        const prisma = makePrisma();
        const r = await run(prisma);
        expect(r).toEqual({ refunded: true, amountMinor: 5000 });
        expect(refund).toHaveBeenCalledWith('sk_platform', 'ref1', 5000, { merchantNote: 'refund:order:o1' });
        expect(post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            reason: 'REFUND_ISSUED', idempotencyKey: 'refund:order:o1', orderId: 'o1',
        }));
        expect(updates(prisma)[0]).toEqual({ where: { id: 'o1', tenantId: 't1', depositState: null }, data: { depositState: 'REFUNDING' } });
        expect(updates(prisma).at(-1).data).toEqual({ depositState: 'REFUNDED' });
    });

    it('claims BEFORE calling the provider (a clearing cannot release the same money)', async () => {
        const prisma = makePrisma();
        const order: string[] = [];
        prisma.order.updateMany.mockImplementation(async () => { order.push('claim'); return { count: 1 }; });
        refund.mockImplementation(async () => { order.push('provider'); return { id: 'r' }; });
        await run(prisma);
        expect(order.slice(0, 2)).toEqual(['claim', 'provider']);
    });

    it('reverses the fee together with the net amount', async () => {
        const prisma = makePrisma({ movements: [{ entries: [
            { account: 'TENANT_PENDING', amountMinor: 4900 }, { account: 'PLATFORM_FEE', amountMinor: 100 },
        ] }] });
        pending.mockReturnValue(4900);
        const r = await run(prisma);
        expect(refund).toHaveBeenCalledWith('sk_platform', 'ref1', 5000, expect.anything());
        expect((refundIssued as any)).toHaveBeenCalledWith(4900, 100, 'TENANT_PENDING');
        expect(r).toEqual({ refunded: true, amountMinor: 5000 });
    });

    it.each([
        ['order missing', { order: null }, 'no_reference'],
        ['not paid', { order: { paymentStatus: 'UNPAID' } }, 'no_reference'],
        ['no reference', { order: { paymentReference: null } }, 'no_reference'],
        ['own gateway', { order: { collectionRoute: 'OWN_GATEWAY' } }, 'not_platform_collected'],
        ['unknown route', { order: { collectionRoute: null } }, 'not_platform_collected'],
        ['never credited', { movements: [] }, 'not_platform_collected'],
        ['not cancelled', { order: { status: 'DELIVERED' } }, 'not_cancelled'],
    ] as const)('refuses without touching the provider: %s', async (_n, over, reason) => {
        const prisma = makePrisma(over as any);
        expect(await run(prisma)).toEqual({ refunded: false, reason });
        expect(refund).not.toHaveBeenCalled();
        expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('nothing pending any more (already refunded or released) is nothing_to_refund', async () => {
        pending.mockReturnValue(0);
        const prisma = makePrisma();
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'nothing_to_refund' });
        expect(refund).not.toHaveBeenCalled();
    });

    it('a lost claim does nothing and reports claim_lost', async () => {
        const prisma = makePrisma({ claim: 0 });
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'claim_lost' });
        expect(refund).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('provider failure: parks REFUND_PENDING (money stays pending), critical alert carries orderId and a how-to', async () => {
        refund.mockRejectedValue(new Error('paystack down sk_live_abc123SECRET'));
        const prisma = makePrisma();
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'provider_failed' });
        expect(updates(prisma).at(-1)).toEqual({
            where: { id: 'o1', tenantId: 't1', depositState: 'REFUNDING' }, data: { depositState: 'REFUND_PENDING' },
        });
        expect(post).not.toHaveBeenCalled();
        const alert = raise.mock.calls[0][1];
        expect(alert).toMatchObject({ kind: 'order.refund_failed', severity: 'critical', tenantId: 't1', dedupeKey: 'order.refund_failed:o1' });
        expect(alert.context.orderId).toBe('o1');
        expect(JSON.stringify(alert)).not.toContain('SECRET');
    });

    it('missing platform key is a failure, not a silent skip', async () => {
        cfg.platformPaystack = null;
        const prisma = makePrisma();
        expect((await run(prisma)).reason).toBe('provider_failed');
        expect(raise).toHaveBeenCalled();
    });

    it('retry mode claims the parked state', async () => {
        const prisma = makePrisma();
        await run(prisma, { retry: true });
        expect(updates(prisma)[0].where.depositState).toBe('REFUND_PENDING');
    });

    it('provider says already reversed: treated as success, ledger still written', async () => {
        refund.mockRejectedValue(new Error('Transaction has already been fully reversed'));
        const prisma = makePrisma();
        expect(await run(prisma, { retry: true })).toEqual({ refunded: true, amountMinor: 5000 });
        expect(post).toHaveBeenCalledTimes(1);
        expect(raise).not.toHaveBeenCalled();
    });

    it('ledger failure after a provider success: parks and raises a critical alert (retry only writes the ledger)', async () => {
        const prisma = makePrisma();
        prisma.$transaction.mockRejectedValue(new Error('db down'));
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'ledger_failed' });
        expect(updates(prisma).at(-1).data).toEqual({ depositState: 'REFUND_PENDING' });
        expect(raise.mock.calls[0][1]).toMatchObject({ kind: 'order.refund_ledger_failed', severity: 'critical', dedupeKey: 'order.refund_ledger_failed:o1' });
    });

    it('a duplicate ledger movement (replay) reports already_refunded', async () => {
        post.mockResolvedValue({ duplicate: true });
        expect(await run(makePrisma(), { retry: true })).toEqual({ refunded: false, reason: 'already_refunded' });
    });
});
