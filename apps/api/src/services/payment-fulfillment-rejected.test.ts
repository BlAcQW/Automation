import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());
vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('./audit.js', () => ({ audit: vi.fn(async () => undefined) }));
vi.mock('./alerts.js', () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock('./notification.js', () => ({
    scheduleNotification: vi.fn(async () => undefined),
    scheduleReminder: vi.fn(async () => undefined),
}));
vi.mock('./notifications.js', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('./calendar.js', () => ({ syncBookingToCalendar: vi.fn(async () => undefined) }));
vi.mock('./wallet-credit.js', () => ({ creditDepositToWallet: vi.fn(async () => ({ credited: true })) }));
vi.mock('./order-refund.js', () => ({ refundOrderPayment: vi.fn(async () => ({ refunded: true, amountMinor: 5000 })) }));

import { publishEvent } from './events/publish.js';
import { raiseAlert } from './alerts.js';
import { audit } from './audit.js';
import { scheduleNotification } from './notification.js';
import { creditDepositToWallet } from './wallet-credit.js';
import { refundOrderPayment } from './order-refund.js';
import { fulfillBookingCharge, fulfillOrderCharge } from './payment-fulfillment.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;
const alerts = () => (raiseAlert as any).mock.calls.map((c: any[]) => c[1]);

const verified = (over: Record<string, unknown> = {}) =>
    ({ status: 'success', amountKobo: 5000, currency: 'GHS', channel: 'card', paidAt: new Date(), ...over }) as any;

const booking = (route: string | null = 'PLATFORM') => ({
    id: 'b1', bookingReference: 'BK-1', depositAmount: 50, collectionRoute: route, customerName: 'Ama',
    customerPhone: '+233241234567', startTime: new Date('2030-01-01T10:00:00Z'), serviceId: 's1', service: { name: 'Cut' },
});
const order = (route: string | null = 'PLATFORM') => ({
    id: 'o1', orderRef: 'ORD-1', customerPhone: '+233241234567', totalAmount: 50, collectionRoute: route,
});

function matches(value: string, cond: unknown): boolean {
    if (cond === undefined) return true;
    if (typeof cond === 'string') return value === cond;
    const c = cond as { in?: string[]; notIn?: string[] };
    if (c.in) return c.in.includes(value);
    if (c.notIn) return !c.notIn.includes(value);
    return false;
}

function world(opts: {
    orderStatus?: string; paymentStatus?: string; tenantCurrency?: string; walletCurrency?: string | null;
} = {}) {
    const state = { status: opts.orderStatus ?? 'PENDING', paymentStatus: opts.paymentStatus ?? 'UNPAID' };
    const events: any[] = [];
    publish.mockImplementation(async (_c: any, input: any) => {
        if (events.some((e) => e.dedupeKey === input.dedupeKey)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        events.push(input);
        return { eventId: 'e' };
    });
    const claim = vi.fn(async ({ where, data }: any) => {
        if (!matches(state.status, where.status) || !matches(state.paymentStatus, where.paymentStatus)) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
    });
    const fastify: any = {
        prisma: {
            booking: { updateMany: claim },
            order: { updateMany: claim },
            tenant: { findUnique: vi.fn(async () => ({ paymentCurrency: opts.tenantCurrency ?? 'GHS' })) },
            wallet: {
                findUnique: vi.fn(async () =>
                    opts.walletCurrency === null ? null : { currency: opts.walletCurrency ?? 'GHS' }),
            },
            notification: { create: vi.fn() },
        },
        queues: { notifications: null, reminders: null },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    return { fastify, state, events, claim };
}

const book = (w: ReturnType<typeof world>, v = verified(), route: string | null = 'PLATFORM', reference = 'ref1') =>
    fulfillBookingCharge({ fastify: w.fastify, logger: w.fastify.log, tenantId: 't1', booking: booking(route), verified: v, reference });
const ord = (w: ReturnType<typeof world>, v = verified(), route: string | null = 'PLATFORM', reference = 'ref1') =>
    fulfillOrderCharge({ fastify: w.fastify, tenantId: 't1', order: order(route), verified: v, reference });

beforeEach(() => {
    vi.clearAllMocks();
    publish.mockReset();
});

describe('currency of a charge must be what was asked', () => {
    it('own-gateway booking paid in a different currency from the tenant currency is rejected', async () => {
        const w = world({ tenantCurrency: 'NGN' });
        const r = await book(w, verified({ currency: 'GHS' }), 'OWN_GATEWAY');
        expect(r).toEqual({ applied: false, rejected: 'currency_mismatch' });
        expect(w.claim).not.toHaveBeenCalled();
        expect(creditDepositToWallet).not.toHaveBeenCalled();
        expect(scheduleNotification).not.toHaveBeenCalled();
        expect(alerts()[0]).toMatchObject({
            kind: 'payment.currency_mismatch', severity: 'critical', tenantId: 't1',
            dedupeKey: 'payment.currency_mismatch:t1:ref1',
        });
        expect(w.events.find((e) => e.type === 'payment.failed')?.payload).toMatchObject({ reason: 'currency_mismatch' });
    });

    it('platform-collected charge must match the WALLET currency, not just the tenant setting', async () => {
        const w = world({ tenantCurrency: 'NGN', walletCurrency: 'GHS' });
        const r = await book(w, verified({ currency: 'NGN' }), 'PLATFORM');
        expect(r).toMatchObject({ applied: false, rejected: 'currency_mismatch' });
        expect(creditDepositToWallet).not.toHaveBeenCalled();
    });

    it('is case-insensitive and lets a matching currency through', async () => {
        const w = world({ tenantCurrency: 'GHS' });
        w.state.status = 'PENDING_PAYMENT';
        const r = await book(w, verified({ currency: 'ghs' }), 'PLATFORM');
        expect(r).toEqual({ applied: true });
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('applies to orders too', async () => {
        const w = world({ tenantCurrency: 'GHS' });
        const r = await ord(w, verified({ currency: 'USD' }));
        expect(r).toMatchObject({ applied: false, rejected: 'currency_mismatch' });
        expect(w.claim).not.toHaveBeenCalled();
        expect(creditDepositToWallet).not.toHaveBeenCalled();
    });

    it('a tenant with no wallet yet is judged by the tenant payment currency', async () => {
        const w = world({ tenantCurrency: 'GHS', walletCurrency: null, orderStatus: 'PENDING' });
        expect(await ord(w, verified({ currency: 'GHS' }))).toEqual({ applied: true });
    });
});

describe('an underpayment is recorded and alerted, never silent', () => {
    it('booking: critical alert per reference, audit row, payment.failed event, nothing claimed or credited', async () => {
        const w = world();
        const r = await book(w, verified({ amountKobo: 100 }));
        expect(r).toEqual({ applied: false, rejected: 'underpaid' });
        expect(w.claim).not.toHaveBeenCalled();
        expect(creditDepositToWallet).not.toHaveBeenCalled();
        expect(alerts()[0]).toMatchObject({
            kind: 'payment.underpaid', severity: 'critical', tenantId: 't1', dedupeKey: 'payment.underpaid:t1:ref1',
            context: expect.objectContaining({ bookingId: 'b1', reference: 'ref1', paidMinor: 100, expectedMinor: 5000 }),
        });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'payments.charge.rejected', targetType: 'Booking', targetId: 'b1',
            metadata: expect.objectContaining({ reason: 'underpaid' }),
        }));
        expect(w.events.filter((e) => e.type === 'payment.failed')).toHaveLength(1);
    });

    it('the alert goes first, so an events outage (which makes Paystack retry) cannot lose it', async () => {
        const w = world();
        publish.mockRejectedValueOnce(new Error('events down'));
        await expect(book(w, verified({ amountKobo: 100 }))).rejects.toThrow('events down');
        expect(alerts()).toHaveLength(1);
        // The retry records the event once and bumps (not duplicates) the alert.
        expect(await book(w, verified({ amountKobo: 100 }))).toMatchObject({ rejected: 'underpaid' });
        expect(w.events.filter((e) => e.type === 'payment.failed')).toHaveLength(1);
        expect(new Set(alerts().map((a: any) => a.dedupeKey)).size).toBe(1);
    });

    it('order: same handling', async () => {
        const w = world();
        const r = await ord(w, verified({ amountKobo: 1 }));
        expect(r).toEqual({ applied: false, rejected: 'underpaid' });
        expect(alerts()[0]).toMatchObject({ kind: 'payment.underpaid', context: expect.objectContaining({ orderId: 'o1' }) });
    });

    it('an overpayment is still accepted', async () => {
        const w = world({ orderStatus: 'PENDING' });
        expect(await ord(w, verified({ amountKobo: 9000 }))).toEqual({ applied: true });
    });
});

describe('order late payment must not resurrect a cancelled order', () => {
    it('a normal PENDING order is confirmed and paid, as before', async () => {
        const w = world({ orderStatus: 'PENDING' });
        expect(await ord(w)).toEqual({ applied: true });
        expect(w.state).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
        expect(scheduleNotification).toHaveBeenCalledTimes(1);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('an order staff already moved on (SHIPPED, unpaid) becomes PAID without its status going backwards', async () => {
        const w = world({ orderStatus: 'SHIPPED' });
        expect(await ord(w)).toEqual({ applied: true });
        expect(w.state).toMatchObject({ status: 'SHIPPED', paymentStatus: 'PAID' });
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
    });

    it('CANCELLED + payment: stays CANCELLED, marked PAID so a refund can find it, no confirmation sent', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        const r = await ord(w);
        expect(r).toEqual({ applied: false });
        expect(w.state).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PAID' });
        expect(scheduleNotification).not.toHaveBeenCalled();
    });

    it('the money is held (credited pending) and a critical alert asks a person to refund', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        await ord(w);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect((creditDepositToWallet as any).mock.calls[0][0]).toMatchObject({ orderId: 'o1', reference: 'ref1', storedRoute: 'PLATFORM' });
        expect(alerts()).toHaveLength(1);
        expect(alerts()[0]).toMatchObject({
            kind: 'payment.after_order_cancelled', severity: 'critical', tenantId: 't1',
            dedupeKey: 'payment.after_order_cancelled:t1:ref1',
            context: expect.objectContaining({ orderId: 'o1', reference: 'ref1', amountMinor: 5000, currency: 'GHS' }),
        });
        expect(w.events.filter((e) => e.type === 'payment.succeeded')).toHaveLength(1);
    });

    it('late payment on a cancelled order is refunded automatically, after the credit, on the stored route', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        const seq: string[] = [];
        (creditDepositToWallet as any).mockImplementationOnce(async () => { seq.push('credit'); return {}; });
        (refundOrderPayment as any).mockImplementationOnce(async () => { seq.push('refund'); return { refunded: true }; });
        await ord(w);
        expect(seq).toEqual(['credit', 'refund']);
        expect(refundOrderPayment).toHaveBeenCalledTimes(1);
        expect((refundOrderPayment as any).mock.calls[0][0]).toMatchObject({ tenantId: 't1', orderId: 'o1', reference: 'ref1' });
    });

    it('a refund that throws never fails the webhook: the critical alert (with orderId) is already out', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        (refundOrderPayment as any).mockRejectedValueOnce(new Error('boom'));
        expect(await ord(w)).toEqual({ applied: false });
        expect(alerts()[0]).toMatchObject({ kind: 'payment.after_order_cancelled', context: expect.objectContaining({ orderId: 'o1' }) });
        expect(w.fastify.log.error).toHaveBeenCalled();
    });

    it('redelivery does not refund twice; a normal paid order is never refunded', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        await ord(w);
        await ord(w);
        expect(refundOrderPayment).toHaveBeenCalledTimes(1);
        const w2 = world({ orderStatus: 'PENDING' });
        await ord(w2);
        expect(refundOrderPayment).toHaveBeenCalledTimes(1);
    });

    it('alert is raised before the credit, so a crash in between cannot lose it', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        const order: string[] = [];
        (raiseAlert as any).mockImplementation(async () => { order.push('alert'); });
        (creditDepositToWallet as any).mockImplementation(async () => { order.push('credit'); return {}; });
        await ord(w);
        expect(order).toEqual(['alert', 'credit']);
    });

    it('redelivery: no second alert, no second credit', async () => {
        const w = world({ orderStatus: 'CANCELLED' });
        await ord(w);
        expect(await ord(w)).toEqual({ applied: false });
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
    });

    it('an already PAID order is a plain no-op', async () => {
        const w = world({ orderStatus: 'CONFIRMED', paymentStatus: 'PAID' });
        expect(await ord(w)).toEqual({ applied: false });
        expect(raiseAlert).not.toHaveBeenCalled();
        expect(creditDepositToWallet).not.toHaveBeenCalled();
    });
});
