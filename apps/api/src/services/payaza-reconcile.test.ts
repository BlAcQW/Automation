import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./payaza.js', async (orig) => ({ ...(await orig<object>()), queryTransaction: vi.fn() }));
vi.mock('./crypto.js', () => ({ decrypt: (v: string) => v.replace(/^enc:/, '') }));
vi.mock('../routes/payments/unattributed.js', () => ({ reportUnattributedCharge: vi.fn() }));

import { queryTransaction } from './payaza.js';
import { reportUnattributedCharge } from '../routes/payments/unattributed.js';
import { registerFulfillmentOwner, registerPaymentFulfiller, resetPaymentFulfillersForTests } from './payment-fulfillers.js';
import { confirmPayazaReference, PayazaQueryFailed } from './payaza-confirm.js';
import {
    awaitingReferences, checkPayazaReference, createPayazaExpiryGuard, createPayazaThrottle, reconcilePayaza,
    LATE_WINDOW_MS, MAX_PER_TENANT_PER_TICK, REQUERY_AFTER_MS, SETTLED_FOR_MS,
} from './payaza-reconcile.js';

const query = queryTransaction as unknown as ReturnType<typeof vi.fn>;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const tenant = { id: 't1', payazaPublicKey: 'enc:PZ-PUB', payazaMode: 'LIVE' };
const ref = (id: string, ts = 1700000000000) => `bf_f_ride_package_${id}_${ts}`;
const fulfiller = vi.fn();
const owner = vi.fn();

const paid = (reference: string, over: Record<string, unknown> = {}) => ({
    status: 'success', amountKobo: 100, currency: 'GHS', paidAt: new Date(), reference, customerEmail: '',
    channel: 'mobile_money', transactionId: 'P-C-20261015-MYISZW8V0E', metadata: null, ...over,
});
const pending = (reference: string) => ({ ...paid(reference), status: 'pending', paidAt: null });

function fakePrisma(over: { tenants?: unknown[]; passes?: unknown[]; rides?: unknown[] } = {}) {
    return {
        tenant: {
            findMany: vi.fn(async () => over.tenants ?? [tenant]),
            findFirst: vi.fn(async ({ where }: any) => (over.tenants ?? [tenant]).find((t: any) => t.id === where.id) ?? null),
        },
        ridePass: { findMany: vi.fn(async () => over.passes ?? []) },
        ride: { findMany: vi.fn(async () => over.rides ?? []) },
    } as any;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetPaymentFulfillersForTests();
    registerPaymentFulfiller('ride_package', fulfiller);
    registerFulfillmentOwner('ride_package', owner);
    owner.mockResolvedValue('t1');
    fulfiller.mockResolvedValue({ status: 'applied' });
});

describe('confirmPayazaReference (shared by webhook, reconciler, sweeper)', () => {
    it('queries Payaza with the tenant key and applies the fulfiller with Payaza\'s transaction reference and channel', async () => {
        query.mockResolvedValue(paid(ref('p1')));
        const res = await confirmPayazaReference({ prisma: {} as any, log }, { tenant, reference: ref('p1'), source: 'reconcile' });
        expect(res).toMatchObject({ outcome: 'dispatched', body: { ok: true, entity: 'ride_package' } });
        expect(query).toHaveBeenCalledWith('PZ-PUB', 'LIVE', ref('p1'));
        expect(fulfiller).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', entityId: 'p1', amountMinor: 100, provider: 'PAYAZA', transactionId: 'P-C-20261015-MYISZW8V0E', channel: 'mobile_money',
        }));
        expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ source: 'reconcile' }), 'Payaza payment confirmed without a webhook');
    });

    it('uses a prefetched answer instead of querying again', async () => {
        await confirmPayazaReference({ prisma: {} as any, log }, { tenant, reference: ref('p1'), source: 'sweeper', prefetched: paid(ref('p1')) as any });
        expect(query).not.toHaveBeenCalled();
        expect(fulfiller).toHaveBeenCalledOnce();
    });

    it('refuses references that are not ours or belong to another tenant', async () => {
        expect(await confirmPayazaReference({ prisma: {} as any, log }, { tenant, reference: 'SHOP-1', source: 'reconcile' })).toEqual({ outcome: 'not_ours' });
        owner.mockResolvedValue('t_other');
        expect(await confirmPayazaReference({ prisma: {} as any, log }, { tenant, reference: ref('p1'), source: 'reconcile' })).toEqual({ outcome: 'not_ours' });
        expect(fulfiller).not.toHaveBeenCalled();
    });

    it('a failed status query throws PayazaQueryFailed (webhook -> 502, reconciler -> retry)', async () => {
        query.mockRejectedValue(new Error('network down'));
        await expect(confirmPayazaReference({ prisma: {} as any, log }, { tenant, reference: ref('p1'), source: 'webhook' })).rejects.toBeInstanceOf(PayazaQueryFailed);
    });

    it('money the fulfiller refuses is reported as unattributed (for a Payaza refund)', async () => {
        query.mockResolvedValue(paid(ref('p1')));
        fulfiller.mockResolvedValue({ status: 'rejected', reason: 'amount_insufficient' });
        await confirmPayazaReference({ prisma: {} as any, log }, { tenant, reference: ref('p1'), source: 'reconcile' });
        expect(reportUnattributedCharge).toHaveBeenCalledWith(expect.anything(), log, 'Payaza', 'fulfillment_rejected:amount_insufficient', expect.objectContaining({ reference: ref('p1'), tenantId: 't1' }));
    });
});

describe('throttle', () => {
    it('re-asks after a minute, and leaves settled references alone for hours', () => {
        const t = createPayazaThrottle();
        expect(t.due('a', 0)).toBe(true);
        t.queried('a', 0);
        expect(t.due('a', REQUERY_AFTER_MS - 1)).toBe(false);
        expect(t.due('a', REQUERY_AFTER_MS)).toBe(true);
        t.settled('b', 0);
        expect(t.due('b', SETTLED_FOR_MS - 1)).toBe(false);
    });
});

describe('checkPayazaReference', () => {
    it('Completed -> confirmed; Initialized -> not_paid (nothing applied); errors -> warn and error', async () => {
        const throttle = createPayazaThrottle();
        query.mockResolvedValueOnce(paid(ref('p1')));
        expect(await checkPayazaReference({ prisma: {} as any, log, throttle }, tenant, ref('p1'), 'reconcile')).toBe('confirmed');
        query.mockResolvedValueOnce(pending(ref('p2')));
        expect(await checkPayazaReference({ prisma: {} as any, log, throttle }, tenant, ref('p2'), 'reconcile')).toBe('not_paid');
        expect(fulfiller).toHaveBeenCalledOnce();
        query.mockRejectedValueOnce(new Error('timeout'));
        expect(await checkPayazaReference({ prisma: {} as any, log, throttle }, tenant, ref('p3'), 'reconcile')).toBe('error');
        expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', source: 'reconcile' }), expect.any(String));
    });

    it('a reference a webhook already applied is "already"; a refused one is "refused"', async () => {
        query.mockResolvedValue(paid(ref('p1')));
        fulfiller.mockResolvedValueOnce({ status: 'already_applied' });
        expect(await checkPayazaReference({ prisma: {} as any, log, throttle: createPayazaThrottle() }, tenant, ref('p1'), 'reconcile')).toBe('already');
        fulfiller.mockResolvedValueOnce({ status: 'rejected', reason: 'not_activated:cap_full' });
        expect(await checkPayazaReference({ prisma: {} as any, log, throttle: createPayazaThrottle() }, tenant, ref('p1'), 'reconcile')).toBe('refused');
    });
});

describe('awaitingReferences', () => {
    it('asks for HELD passes / PENDING_PAYMENT rides and the 2h late window, unpaid, with a reference; keeps only ours', async () => {
        const now = new Date('2026-10-15T17:00:00Z');
        const prisma = fakePrisma({
            passes: [{ paymentReference: ref('p1') }, { paymentReference: 'someone-else' }],
            rides: [{ paymentReference: 'bf_f_ride_payg_r1_1700000000000' }, { paymentReference: ref('p1') }],
        });
        registerPaymentFulfiller('ride_payg', fulfiller);
        expect(await awaitingReferences(prisma, 't1', now)).toEqual([ref('p1'), 'bf_f_ride_payg_r1_1700000000000']);
        const passWhere = prisma.ridePass.findMany.mock.calls[0][0].where;
        expect(passWhere).toMatchObject({ tenantId: 't1', paidAt: null, paymentReference: { not: null } });
        expect(passWhere.OR).toEqual([
            { status: 'HELD' },
            { status: 'CANCELLED', cancelReason: 'hold_expired', cancelledAt: { gte: new Date(now.getTime() - LATE_WINDOW_MS) } },
        ]);
        expect(prisma.ride.findMany.mock.calls[0][0].where.OR).toEqual([
            { status: 'PENDING_PAYMENT' },
            { status: 'CANCELLED', cancelReason: 'payment_timeout', cancelledAt: { gte: new Date(now.getTime() - LATE_WINDOW_MS) } },
        ]);
    });
});

describe('reconcilePayaza', () => {
    it('only connected PAYAZA tenants; confirms paid references, skips recently asked ones, caps per tenant', async () => {
        const passes = Array.from({ length: 30 }, (_, i) => ({ paymentReference: ref(`p${i}`) }));
        const prisma = fakePrisma({ passes });
        query.mockImplementation(async (_k: string, _m: string, reference: string) => (reference === ref('p0') ? paid(reference) : pending(reference)));
        const throttle = createPayazaThrottle();
        const at = new Date('2026-10-15T17:00:00Z');

        const first = await reconcilePayaza({ prisma, log, throttle }, at);
        expect(prisma.tenant.findMany.mock.calls[0][0].where).toEqual({ paymentProvider: 'PAYAZA', payazaPublicKey: { not: null }, payazaSecretKey: { not: null } });
        expect(first).toMatchObject({ tenants: 1, queried: MAX_PER_TENANT_PER_TICK, confirmed: 1, errors: 0 });
        expect(fulfiller).toHaveBeenCalledOnce();

        // 30s later: the 25 just asked are skipped; the other 5 are asked.
        const second = await reconcilePayaza({ prisma, log, throttle }, new Date(at.getTime() + 30_000));
        expect(second.queried).toBe(5);
        // A minute after the first tick, its 24 unpaid ones are due again (the 5 asked at +30s are not yet);
        // the confirmed one is settled and never asked again.
        const third = await reconcilePayaza({ prisma, log, throttle }, new Date(at.getTime() + REQUERY_AFTER_MS));
        expect(query.mock.calls.slice(30).map((c) => c[2])).not.toContain(ref('p0'));
        expect(third.queried).toBe(24);
    });

    it('one failing reference does not stop the others', async () => {
        const prisma = fakePrisma({ passes: [{ paymentReference: ref('p1') }, { paymentReference: ref('p2') }] });
        query.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce(paid(ref('p2')));
        const r = await reconcilePayaza({ prisma, log, throttle: createPayazaThrottle() });
        expect(r).toMatchObject({ queried: 2, confirmed: 1, errors: 1 });
    });

    it('no Payaza tenants: no queries', async () => {
        const r = await reconcilePayaza({ prisma: fakePrisma({ tenants: [] }), log, throttle: createPayazaThrottle() });
        expect(r.queried).toBe(0);
        expect(query).not.toHaveBeenCalled();
    });
});

describe('createPayazaExpiryGuard (ride sweeper)', () => {
    it('asks Payaza once per reference of a PAYAZA tenant and confirms the paid ones', async () => {
        const prisma = fakePrisma();
        query.mockImplementation(async (_k: string, _m: string, reference: string) => (reference === ref('p1') ? paid(reference) : pending(reference)));
        const guard = createPayazaExpiryGuard({ prisma, log, throttle: createPayazaThrottle() });
        expect(await guard([
            { tenantId: 't1', paymentReference: ref('p1') },
            { tenantId: 't1', paymentReference: ref('p2') },
            { tenantId: 't1', paymentReference: null },
        ])).toBe(1);
        expect(query).toHaveBeenCalledTimes(2);
        expect(fulfiller).toHaveBeenCalledOnce();
    });

    it('Paystack tenants are left alone; a Payaza outage confirms nothing and does not throw', async () => {
        const prisma = fakePrisma({ tenants: [] });
        const guard = createPayazaExpiryGuard({ prisma, log, throttle: createPayazaThrottle() });
        expect(await guard([{ tenantId: 't_paystack', paymentReference: ref('p1') }])).toBe(0);
        expect(query).not.toHaveBeenCalled();

        query.mockRejectedValue(new Error('down'));
        const guard2 = createPayazaExpiryGuard({ prisma: fakePrisma(), log, throttle: createPayazaThrottle() });
        expect(await guard2([{ tenantId: 't1', paymentReference: ref('p1') }])).toBe(0);
    });
});
