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

import { publishEvent } from './events/publish.js';
import { raiseAlert } from './alerts.js';
import { scheduleNotification } from './notification.js';
import { syncBookingToCalendar } from './calendar.js';
import { creditDepositToWallet } from './wallet-credit.js';
import { fulfillBookingCharge, republishPaymentSucceeded, recordedPaymentSucceeded, ensurePaymentSucceededOnReturn } from './payment-fulfillment.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

const verified = { status: 'success', amountKobo: 5000, currency: 'GHS', channel: 'card', paidAt: new Date() } as any;
const booking = {
    id: 'b1', bookingReference: 'BK-1', depositAmount: 50, collectionRoute: 'PLATFORM', customerName: 'Ama',
    customerPhone: '+233241234567', startTime: new Date('2030-01-01T10:00:00Z'), serviceId: 's1', service: { name: 'Cut' },
};

/** A one-row booking table whose updateMany honours the where clause, like the database does. */
function matches(value: string, cond: unknown): boolean {
    if (cond === undefined) return true;
    if (typeof cond === 'string') return value === cond;
    const c = cond as { in?: string[]; notIn?: string[] };
    if (c.in) return c.in.includes(value);
    if (c.notIn) return !c.notIn.includes(value);
    return false;
}

function world(row: { status: string; paymentStatus: string }) {
    const state = { ...row, paidAt: null as Date | null };
    const events: any[] = [];
    publish.mockImplementation(async (_c: any, input: any) => {
        if (events.some((e) => e.dedupeKey === input.dedupeKey)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        events.push(input);
        return { eventId: 'e' };
    });
    const fastify = {
        prisma: {
            booking: {
                updateMany: vi.fn(async ({ where, data }: any) => {
                    if (!matches(state.status, where.status) || !matches(state.paymentStatus, where.paymentStatus)) return { count: 0 };
                    Object.assign(state, data);
                    return { count: 1 };
                }),
            },
            notification: { create: vi.fn() },
            tenant: { findUnique: vi.fn(async () => ({ paymentCurrency: 'GHS' })) },
            wallet: { findUnique: vi.fn(async () => ({ currency: 'GHS' })) },
        },
        queues: { notifications: null, reminders: null },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as any;
    return { fastify, state, events };
}

const run = (fastify: any, reference = 'ref1') =>
    fulfillBookingCharge({ fastify, logger: fastify.log, tenantId: 't1', booking, verified, reference });

beforeEach(() => {
    vi.clearAllMocks();
    publish.mockReset();
});

describe('booking claim', () => {
    it('a normal payment confirms a PENDING_PAYMENT booking exactly as before', async () => {
        const w = world({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
        expect(await run(w.fastify)).toEqual({ applied: true });
        expect(w.state).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
        expect(scheduleNotification).toHaveBeenCalledTimes(1);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('a redelivery after a normal payment changes nothing and alerts nothing', async () => {
        const w = world({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
        await run(w.fastify);
        expect(await run(w.fastify)).toEqual({ applied: false });
        expect(scheduleNotification).toHaveBeenCalledTimes(1);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect(raiseAlert).not.toHaveBeenCalled();
        expect(w.events).toHaveLength(1);
    });

    it('LATE PAYMENT: a cancelled (expired-hold) booking is NOT resurrected', async () => {
        const w = world({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
        const r = await run(w.fastify);
        expect(r).toEqual({ applied: false });
        expect(w.state.status).toBe('CANCELLED');
        expect(w.state.paymentStatus).toBe('PAID');
        expect(w.state.paidAt).toBeInstanceOf(Date);
        // No confirmation to the customer, no calendar entry, no reminder.
        expect(scheduleNotification).not.toHaveBeenCalled();
        expect(syncBookingToCalendar).not.toHaveBeenCalled();
    });

    it('LATE PAYMENT: the money is held (credited pending), the fact is published once and a person is alerted', async () => {
        const w = world({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
        await run(w.fastify);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect(w.events.filter((e) => e.type === 'payment.succeeded')).toHaveLength(1);
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect((raiseAlert as any).mock.calls[0][1]).toMatchObject({
            kind: 'payment.after_hold_expired',
            severity: 'critical',
            tenantId: 't1',
            dedupeKey: 'payment.after_hold_expired:t1:ref1',
            context: expect.objectContaining({ bookingId: 'b1', reference: 'ref1' }),
        });
    });

    it('LATE PAYMENT: the alert is raised before the credit, so a crash in between cannot lose it', async () => {
        const w = world({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
        const order: string[] = [];
        (raiseAlert as any).mockImplementation(async () => { order.push('alert'); });
        (creditDepositToWallet as any).mockImplementation(async () => { order.push('credit'); return {}; });
        await run(w.fastify);
        expect(order).toEqual(['alert', 'credit']);
    });

    it('LATE PAYMENT redelivery: no second alert, no second credit, still one event', async () => {
        const w = world({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
        await run(w.fastify);
        expect(await run(w.fastify)).toEqual({ applied: false });
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect(creditDepositToWallet).toHaveBeenCalledTimes(1);
        expect(w.events).toHaveLength(1);
    });
});

describe('republishPaymentSucceeded (PAID short-circuits)', () => {
    const args = (prisma: any = {}) => ({
        prisma, logger: { error: vi.fn() }, tenantId: 't1', reference: 'ref1', amountMinor: 5000, currency: 'GHS', extra: { bookingId: 'b1' },
    });

    it('publishes with the same once-key the fulfilment uses', async () => {
        publish.mockResolvedValue({ eventId: 'e' });
        expect(await republishPaymentSucceeded(args())).toBeNull();
        expect(publish.mock.calls[0][1]).toMatchObject({
            tenantId: 't1', type: 'payment.succeeded', dedupeKey: 'payment.succeeded:reference:ref1',
            payload: { bookingId: 'b1', reference: 'ref1', amount: 5000, currency: 'GHS', paymentId: 'ref1' },
        });
    });

    it('is a no-op when already published (unique key)', async () => {
        publish.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        expect(await republishPaymentSucceeded(args())).toBeNull();
    });

    it('returns (does not throw) the error when the events store is down', async () => {
        const boom = new Error('events down');
        publish.mockRejectedValue(boom);
        const a = args();
        expect(await republishPaymentSucceeded(a)).toBe(boom);
        expect(a.logger.error).toHaveBeenCalled();
    });

    it('refuses an unusable amount or currency instead of publishing garbage', async () => {
        expect(await republishPaymentSucceeded({ ...args(), amountMinor: 0 })).toBeNull();
        expect(await republishPaymentSucceeded({ ...args(), currency: undefined as any })).toBeNull();
        expect(publish).not.toHaveBeenCalled();
    });

    it('recordedPaymentSucceeded reflects whether the keyed event exists, and fails open', async () => {
        const found = { domainEvent: { findFirst: vi.fn(async () => ({ id: 'x' })) } };
        const missing = { domainEvent: { findFirst: vi.fn(async () => null) } };
        const broken = { domainEvent: { findFirst: vi.fn(async () => { throw new Error('db'); }) } };
        expect(await recordedPaymentSucceeded(found, 't1', 'ref1')).toBe(true);
        expect(found.domainEvent.findFirst).toHaveBeenCalledWith({
            where: { tenantId: 't1', dedupeKey: 'payment.succeeded:reference:ref1' }, select: { id: true },
        });
        expect(await recordedPaymentSucceeded(missing, 't1', 'ref1')).toBe(false);
        expect(await recordedPaymentSucceeded(broken, 't1', 'ref1')).toBe(false);
    });
});

describe('ensurePaymentSucceededOnReturn', () => {
    const base = (over: Record<string, unknown> = {}) => ({
        prisma: { domainEvent: { findFirst: vi.fn(async () => null) } },
        logger: { error: vi.fn() },
        tenantId: 't1', reference: 'ref1', extra: { bookingId: 'b1' },
        verify: vi.fn(async () => verified),
        ...over,
    }) as any;

    it('already recorded: no Paystack call, no publish', async () => {
        const a = base({ prisma: { domainEvent: { findFirst: vi.fn(async () => ({ id: 'x' })) } } });
        await ensurePaymentSucceededOnReturn(a);
        expect(a.verify).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('not recorded: verifies and publishes once-keyed', async () => {
        publish.mockResolvedValue({ eventId: 'e' });
        await ensurePaymentSucceededOnReturn(base());
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toMatchObject({ dedupeKey: 'payment.succeeded:reference:ref1', payload: { amount: 5000, currency: 'GHS' } });
    });

    it('not a success at Paystack: nothing published', async () => {
        await ensurePaymentSucceededOnReturn(base({ verify: vi.fn(async () => ({ ...verified, status: 'failed' })) }));
        expect(publish).not.toHaveBeenCalled();
    });

    it('never throws: a Paystack or events failure is logged and swallowed', async () => {
        const a = base({ verify: vi.fn(async () => { throw new Error('paystack down'); }) });
        await expect(ensurePaymentSucceededOnReturn(a)).resolves.toBeUndefined();
        publish.mockRejectedValue(new Error('events down'));
        await expect(ensurePaymentSucceededOnReturn(base())).resolves.toBeUndefined();
    });
});
