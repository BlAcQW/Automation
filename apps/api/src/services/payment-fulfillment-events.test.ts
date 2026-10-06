import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());
vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('./audit.js', () => ({ audit: vi.fn(async () => undefined) }));
vi.mock('./notification.js', () => ({
    scheduleNotification: vi.fn(async () => undefined),
    scheduleReminder: vi.fn(async () => undefined),
}));
vi.mock('./notifications.js', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('./calendar.js', () => ({ syncBookingToCalendar: vi.fn(async () => undefined) }));
vi.mock('./wallet-credit.js', () => ({ creditDepositToWallet: vi.fn(async () => ({})) }));

import { publishEvent } from './events/publish.js';
import { fulfillBookingCharge, fulfillOrderCharge } from './payment-fulfillment.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

const verified = (over: Record<string, unknown> = {}) =>
    ({ status: 'success', amountKobo: 5000, currency: 'GHS', channel: 'card', paidAt: new Date(), ...over }) as any;

function fastify(claimCount = 1) {
    const events: any[] = [];
    publish.mockImplementation(async (_c: any, input: any) => {
        // DomainEvent @@unique([tenantId, dedupeKey]): a repeated key is a P2002, which publishEventOnce reports as 'duplicate'.
        if (input.dedupeKey && events.some((e) => e.tenantId === input.tenantId && e.dedupeKey === input.dedupeKey)) {
            throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        events.push(input);
        return { eventId: 'e' };
    });
    const tx = {
        $executeRaw: vi.fn(async () => 0),
        domainEvent: {
            findFirst: vi.fn(async ({ where }: any) =>
                events.find((e) => e.tenantId === where.tenantId && e.type === where.type && e.payload[where.payload.path[0]] === where.payload.equals) ?? null),
        },
    };
    return {
        prisma: {
            $transaction: vi.fn(async (fn: any) => fn(tx)),
            booking: { updateMany: vi.fn(async () => ({ count: claimCount })) },
            order: { updateMany: vi.fn(async () => ({ count: claimCount })) },
            notification: { create: vi.fn() },
            tenant: { findUnique: vi.fn(async () => ({ paymentCurrency: 'GHS' })) },
            wallet: { findUnique: vi.fn(async () => ({ currency: 'GHS' })) },
        },
        events,
        queues: { notifications: null, reminders: null },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
}

const booking = {
    id: 'b1', bookingReference: 'BK-1', depositAmount: 50, collectionRoute: null, customerName: 'Ama',
    customerPhone: '+233241234567', startTime: new Date('2030-01-01T10:00:00Z'), serviceId: 's1', service: { name: 'Cut' },
};
const order = { id: 'o1', orderRef: 'ORD-1', customerPhone: '+233241234567', totalAmount: 50, collectionRoute: null };

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('booking charge events', () => {
    it('an underpaid charge redelivered by Paystack publishes payment.failed only once', async () => {
        const f = fastify();
        const args = { fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified({ amountKobo: 100 }), reference: 'ref2' };
        await fulfillBookingCharge(args);
        await fulfillBookingCharge(args);
        expect(f.events.filter((e: any) => e.type === 'payment.failed')).toHaveLength(1);
    });

    it('publishes payment.succeeded once the payment claim is won', async () => {
        const f = fastify();
        const r = await fulfillBookingCharge({ fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified(), reference: 'ref1' });
        expect(r).toEqual({ applied: true });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1',
            type: 'payment.succeeded',
            payload: { v: 1, bookingId: 'b1', paymentId: 'ref1', amount: 5000, currency: 'GHS', reference: 'ref1' },
            dedupeKey: 'payment.succeeded:reference:ref1',
        });
    });

    it('a duplicate delivery (claim lost) publishes nothing NEW: payment.succeeded exists once per reference', async () => {
        const f = fastify();
        const args = { fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified(), reference: 'ref1' };
        await fulfillBookingCharge(args);
        f.prisma.booking.updateMany.mockResolvedValue({ count: 0 });
        expect(await fulfillBookingCharge(args)).toEqual({ applied: false });
        expect(publish.mock.calls.filter((c) => (c[1] as any).type === 'payment.succeeded')).toHaveLength(2); // second hit the unique key
        expect(f.events.filter((e: any) => e.type === 'payment.succeeded')).toHaveLength(1);
    });

    it('LOST EVENT: when the first attempt died after the claim, the redelivery (claim lost) still publishes payment.succeeded', async () => {
        const f = fastify(0); // the row is already PAID from the first attempt, which never published
        const r = await fulfillBookingCharge({ fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified(), reference: 'ref1' });
        expect(r).toEqual({ applied: false });
        expect(f.events.filter((e: any) => e.type === 'payment.succeeded')).toEqual([
            expect.objectContaining({ dedupeKey: 'payment.succeeded:reference:ref1', payload: expect.objectContaining({ bookingId: 'b1', reference: 'ref1' }) }),
        ]);
    });

    it('publishes the success fact BEFORE the paid claim', async () => {
        const f = fastify();
        const order: string[] = [];
        publish.mockImplementation(async (_c: any, input: any) => { order.push(`publish:${input.type}`); return { eventId: 'e' }; });
        f.prisma.booking.updateMany.mockImplementation(async () => { order.push('claim'); return { count: 1 }; });
        await fulfillBookingCharge({ fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified(), reference: 'ref1' });
        expect(order.slice(0, 2)).toEqual(['publish:payment.succeeded', 'claim']);
    });

    it('an underpayment publishes payment.failed with the reason and confirms nothing', async () => {
        const f = fastify();
        const r = await fulfillBookingCharge({ fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified({ amountKobo: 100 }), reference: 'ref2' });
        expect(r).toEqual({ applied: false, rejected: 'underpaid' });
        expect(f.prisma.booking.updateMany).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1',
            type: 'payment.failed',
            payload: { v: 1, bookingId: 'b1', paymentId: 'ref2', amount: 100, currency: 'GHS', reference: 'ref2', reason: 'underpaid' },
            dedupeKey: 'payment.failed:reference:ref2',
        });
    });

    it('an events outage never blocks the money: the booking is still confirmed and credited, then the call throws so the redelivery publishes the event', async () => {
        publish.mockRejectedValueOnce(new Error('events db down'));
        const f = fastify();
        const args = { fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified(), reference: 'ref1' };
        await expect(fulfillBookingCharge(args)).rejects.toThrow('events db down');
        expect(f.prisma.booking.updateMany).toHaveBeenCalledTimes(1); // claimed anyway
        expect(f.events).toHaveLength(0);

        f.prisma.booking.updateMany.mockResolvedValue({ count: 0 }); // the redelivery
        await expect(fulfillBookingCharge(args)).resolves.toEqual({ applied: false });
        expect(f.events.filter((e: any) => e.type === 'payment.succeeded')).toHaveLength(1);
    });

    it('an underpayment whose publish fails throws (nothing was claimed, so the retry is safe) and never doubles', async () => {
        publish.mockRejectedValueOnce(new Error('events db down'));
        const f = fastify();
        const args = { fastify: f, logger: f.log, tenantId: 't1', booking, verified: verified({ amountKobo: 100 }), reference: 'ref9' };
        await expect(fulfillBookingCharge(args)).rejects.toThrow('events db down');
        expect(await fulfillBookingCharge(args)).toEqual({ applied: false, rejected: 'underpaid' });
        expect(f.events.filter((e: any) => e.type === 'payment.failed')).toHaveLength(1);
    });
});

describe('order charge events', () => {
    it('publishes payment.succeeded with the order id', async () => {
        const f = fastify();
        const r = await fulfillOrderCharge({ fastify: f, tenantId: 't1', order, verified: verified(), reference: 'ref3' });
        expect(r).toEqual({ applied: true });
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1',
            type: 'payment.succeeded',
            payload: { v: 1, orderId: 'o1', paymentId: 'ref3', amount: 5000, currency: 'GHS', reference: 'ref3' },
            dedupeKey: 'payment.succeeded:reference:ref3',
        });
    });

    it('duplicate (claim lost) still publishes once; underpaid: payment.failed; events outage: applied then throws for the retry', async () => {
        const dup = fastify(0);
        await fulfillOrderCharge({ fastify: dup, tenantId: 't1', order, verified: verified(), reference: 'ref3' });
        await fulfillOrderCharge({ fastify: dup, tenantId: 't1', order, verified: verified(), reference: 'ref3' });
        expect(dup.events.filter((e: any) => e.type === 'payment.succeeded')).toHaveLength(1);
        publish.mockClear();

        const f = fastify();
        await fulfillOrderCharge({ fastify: f, tenantId: 't1', order, verified: verified({ amountKobo: 1 }), reference: 'ref4' });
        expect(publish.mock.calls[0][1]).toMatchObject({ type: 'payment.failed', payload: { orderId: 'o1', reason: 'underpaid' } });

        const g = fastify();
        publish.mockRejectedValue(new Error('down'));
        await expect(fulfillOrderCharge({ fastify: g, tenantId: 't1', order, verified: verified(), reference: 'ref5' })).rejects.toThrow('down');
        expect(g.prisma.order.updateMany).toHaveBeenCalledTimes(1);
    });
});
