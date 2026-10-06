import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./publish.js', () => ({ publishEvent: vi.fn() }));

import { publishEvent } from './publish.js';
import {
    publishEventSafe,
    publishEventOnce,
    emitMessageReceived,
    emitMessageSent,
    emitConversationHandoff,
    emitConversationResumed,
    emitBookingCreated,
    emitBookingCancelled,
    emitBookingCompleted,
    emitOrderCreated,
    emitPaymentSucceeded,
    emitPaymentFailed,
} from './emit.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

/**
 * Emulates the DB: DomainEvent @@unique([tenantId, dedupeKey]) raises P2002 on a
 * second insert, exactly as Prisma does. Atomicity comes from the constraint,
 * not from any lock, so there is no mutex here.
 */
function memoryPrisma() {
    const events: any[] = [];
    const prisma: any = { events };
    publish.mockImplementation(async (_c: any, input: any) => {
        await new Promise((r) => setTimeout(r, 5));
        if (input.dedupeKey && events.some((e) => e.tenantId === input.tenantId && e.dedupeKey === input.dedupeKey)) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        events.push({ id: `e${events.length + 1}`, ...input });
        return { eventId: `e${events.length}` };
    });
    return prisma;
}

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('publishEventSafe', () => {
    it('publishes with payload version v: 1 and reports success', async () => {
        const ok = await publishEventSafe({} as any, { tenantId: 't1', type: 'booking.created', payload: { bookingId: 'b1' } });
        expect(ok).toBe(true);
        expect(publish).toHaveBeenCalledWith({}, { tenantId: 't1', type: 'booking.created', payload: { v: 1, bookingId: 'b1' }});
    });

    it('never throws when the publish fails: returns false and logs', async () => {
        publish.mockRejectedValue(new Error('db down'));
        const warn = vi.fn();
        await expect(
            publishEventSafe({} as any, { tenantId: 't1', type: 'order.created', payload: {} }, { warn }),
        ).resolves.toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('survives a synchronous throw from the client too', async () => {
        publish.mockImplementation(() => { throw new Error('sync boom'); });
        await expect(publishEventSafe({} as any, { tenantId: 't1', type: 'x.y', payload: {} })).resolves.toBe(false);
    });

    it('cannot be tricked into a different version by the payload', async () => {
        await publishEventSafe({} as any, { tenantId: 't1', type: 'x.y', payload: { v: 9 } });
        expect((publish.mock.calls[0][1] as any).payload.v).toBe(1);
    });
});

describe('publishEventOnce', () => {
    const input = { tenantId: 't1', type: 'payment.succeeded', payload: { v: 1, reference: 'r1' } };
    const dedupe = { field: 'reference', equals: 'r1' };

    it('publishes the first time and reports duplicate afterwards (P2002), without scanning payloads', async () => {
        const prisma = memoryPrisma();
        expect(await publishEventOnce(prisma, input, dedupe)).toBe('published');
        expect(await publishEventOnce(prisma, input, dedupe)).toBe('duplicate');
        expect(prisma.events).toHaveLength(1);
        expect(prisma.events[0].dedupeKey).toBe('payment.succeeded:reference:r1');
    });

    it('two racing callers publish exactly one event', async () => {
        const prisma = memoryPrisma();
        const results = await Promise.all([
            publishEventOnce(prisma, input, dedupe),
            publishEventOnce(prisma, input, dedupe),
            publishEventOnce(prisma, input, dedupe),
        ]);
        expect(results.filter((r) => r === 'published')).toHaveLength(1);
        expect(results.filter((r) => r === 'duplicate')).toHaveLength(2);
        expect(prisma.events).toHaveLength(1);
    });

    it('is scoped by tenant and type: the same value elsewhere is not a duplicate', async () => {
        const prisma = memoryPrisma();
        await publishEventOnce(prisma, input, dedupe);
        expect(await publishEventOnce(prisma, { ...input, tenantId: 't2' }, dedupe)).toBe('published');
        expect(await publishEventOnce(prisma, { ...input, type: 'payment.failed' }, dedupe)).toBe('published');
    });

    it('does not opt payment events out of storage (idempotency records are always kept)', async () => {
        const prisma = memoryPrisma();
        await publishEventOnce(prisma, input, dedupe);
        expect((publish.mock.calls[0][1] as any).storeOnlyIfSubscribed).toBeUndefined();
    });

    it('reports skipped when publishing wrote nothing (fan-out-only type, no subscriber)', async () => {
        publish.mockResolvedValue({ eventId: null });
        expect(await publishEventOnce({} as any, { ...input, type: 'message.received' }, dedupe)).toBe('skipped');
    });

    it('propagates non-unique failures (the caller decides whether that is fatal)', async () => {
        const prisma = memoryPrisma();
        publish.mockRejectedValue(new Error('db down'));
        await expect(publishEventOnce(prisma, input, dedupe)).rejects.toThrow('db down');
    });

    it('does not mistake other Prisma errors for a duplicate', async () => {
        publish.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));
        await expect(publishEventOnce({} as any, input, dedupe)).rejects.toThrow('fk');
    });
});

describe('typed emitters (all best-effort, all v: 1)', () => {
    const payloadOf = () => (publish.mock.calls[0][1] as any);

    it('message.received carries text, type, channel, ids and customerId', async () => {
        await emitMessageReceived({} as any, {
            tenantId: 't1', conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP',
            customerId: 'cu1', text: 'hello', type: 'TEXT',
        });
        expect(payloadOf()).toEqual({
            tenantId: 't1', type: 'message.received',
            payload: { v: 1, conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP', customerId: 'cu1', text: 'hello', type: 'TEXT' },
        });
    });

    it('message.received defaults customerId to null and text to empty', async () => {
        await emitMessageReceived({} as any, { tenantId: 't1', conversationId: 'c1', messageId: 'm1', channel: 'INSTAGRAM', type: 'IMAGE' });
        expect(payloadOf().payload).toMatchObject({ customerId: null, text: '', type: 'IMAGE' });
    });

    it('message.received strict mode propagates failures (external app delivery)', async () => {
        publish.mockRejectedValue(new Error('down'));
        await expect(
            emitMessageReceived({} as any, { tenantId: 't1', conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP', type: 'TEXT', strict: true }),
        ).rejects.toThrow('down');
    });

    it('message.received non-strict swallows failures', async () => {
        publish.mockRejectedValue(new Error('down'));
        await expect(
            emitMessageReceived({} as any, { tenantId: 't1', conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP', type: 'TEXT' }),
        ).resolves.toBeUndefined();
    });

    it('message.received strict + once dedupes a retried inbound', async () => {
        const prisma = memoryPrisma();
        const args = { tenantId: 't1', conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP' as const, type: 'TEXT', strict: true, once: true };
        await emitMessageReceived(prisma, args);
        await emitMessageReceived(prisma, args);
        expect(prisma.events).toHaveLength(1);
        expect(prisma.events[0].dedupeKey).toBe('message.received:messageId:m1');
    });

    it('message.sent', async () => {
        await emitMessageSent({} as any, { tenantId: 't1', conversationId: 'c1', messageId: 'm2', channel: 'WHATSAPP', sentBy: 'FLOW' });
        expect(payloadOf()).toMatchObject({ type: 'message.sent', payload: { v: 1, conversationId: 'c1', messageId: 'm2', channel: 'WHATSAPP', sentBy: 'FLOW' } });
    });

    it('conversation.handoff defaults to a human with a nullable reason', async () => {
        await emitConversationHandoff({} as any, { tenantId: 't1', conversationId: 'c1' });
        expect(payloadOf()).toMatchObject({ type: 'conversation.handoff', payload: { v: 1, conversationId: 'c1', to: 'HUMAN', reason: null } });
    });

    it('conversation.resumed', async () => {
        await emitConversationResumed({} as any, { tenantId: 't1', conversationId: 'c1' });
        expect(payloadOf()).toMatchObject({ type: 'conversation.resumed', payload: { v: 1, conversationId: 'c1' } });
    });

    it('booking events', async () => {
        const start = new Date('2030-01-01T10:00:00Z');
        await emitBookingCreated({} as any, { tenantId: 't1', bookingId: 'b1', customerId: null, startsAt: start });
        await emitBookingCancelled({} as any, { tenantId: 't1', bookingId: 'b1', reason: 'dashboard' });
        await emitBookingCompleted({} as any, { tenantId: 't1', bookingId: 'b1' });
        expect(publish.mock.calls.map((c) => (c[1] as any).type)).toEqual(['booking.created', 'booking.cancelled', 'booking.completed']);
        expect((publish.mock.calls[0][1] as any).payload).toEqual({ v: 1, bookingId: 'b1', customerId: null, startsAt: '2030-01-01T10:00:00.000Z' });
        expect((publish.mock.calls[1][1] as any).payload).toEqual({ v: 1, bookingId: 'b1', reason: 'dashboard' });
    });

    it('order.created totals are in minor units', async () => {
        await emitOrderCreated({} as any, { tenantId: 't1', orderId: 'o1', customerId: 'cu1', total: 20.1, currency: 'GHS' });
        expect(payloadOf().payload).toEqual({ v: 1, orderId: 'o1', customerId: 'cu1', total: 2010, currency: 'GHS' });
    });

    it('payment events use the reference as paymentId', async () => {
        await emitPaymentSucceeded({} as any, { tenantId: 't1', reference: 'ref1', amountMinor: 5000, currency: 'GHS', extra: { bookingId: 'b1' } });
        expect((publish.mock.calls[0][1] as any).payload).toEqual({
            v: 1, paymentId: 'ref1', amount: 5000, currency: 'GHS', reference: 'ref1', bookingId: 'b1',
        });
    });

    it('payment.failed publishes once per reference', async () => {
        const prisma = memoryPrisma();
        const args = { tenantId: 't1', reference: 'ref2', amountMinor: 100, currency: 'GHS', reason: 'underpaid' };
        await emitPaymentFailed(prisma, args);
        await emitPaymentFailed(prisma, args);
        expect(prisma.events).toHaveLength(1);
        expect(prisma.events[0]).toMatchObject({
            type: 'payment.failed', payload: { v: 1, paymentId: 'ref2', amount: 100, reason: 'underpaid' },
        });
    });

    it('every emitter swallows a failed publish', async () => {
        publish.mockRejectedValue(new Error('down'));
        const p = {} as any;
        await expect(Promise.all([
            emitMessageSent(p, { tenantId: 't', conversationId: 'c', messageId: 'm', channel: 'WHATSAPP', sentBy: 'AI' }),
            emitConversationHandoff(p, { tenantId: 't', conversationId: 'c', reason: 'x' }),
            emitConversationResumed(p, { tenantId: 't', conversationId: 'c' }),
            emitBookingCreated(p, { tenantId: 't', bookingId: 'b', customerId: null, startsAt: new Date() }),
            emitBookingCancelled(p, { tenantId: 't', bookingId: 'b', reason: null }),
            emitBookingCompleted(p, { tenantId: 't', bookingId: 'b' }),
            emitOrderCreated(p, { tenantId: 't', orderId: 'o', customerId: null, total: 1, currency: 'GHS' }),
            emitPaymentSucceeded(p, { tenantId: 't', reference: 'r', amountMinor: 1, currency: 'GHS' }),
            emitPaymentFailed(p, { tenantId: 't', reference: 'r', amountMinor: 1, currency: 'GHS', reason: 'x' }),
        ])).resolves.toBeDefined();
    });
});
