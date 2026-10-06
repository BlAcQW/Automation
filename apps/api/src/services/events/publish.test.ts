import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishEvent, publishTestEvent, clearBillingUnitCache, TX_NUDGE_DELAY_MS, BILLING_UNIT_CACHE_TTL_MS } from './publish.js';
import { setDeliveryDispatcher } from './dispatcher.js';
import { fakeEventsPrisma } from './testing.js';
import { EVENT_TYPES, isEventType, isFanOutOnlyType } from './catalogue.js';

const sub = (id: string, tenantId: string, events: string[], extra: object = {}) => ({ id, tenantId, events, isActive: true, ...extra });

afterEach(() => setDeliveryDispatcher(null));

describe('publishEvent fan-out', () => {
    it('creates one event and a PENDING delivery per matching active subscription of THAT tenant', async () => {
        const prisma = fakeEventsPrisma({
            subs: [
                sub('s-match', 't1', ['payment.succeeded']),
                sub('s-wild', 't1', ['*']),
                sub('s-other-type', 't1', ['booking.created']),
                sub('s-inactive', 't1', ['payment.succeeded'], { isActive: false }),
                sub('s-other-tenant', 't2', ['payment.succeeded']),
            ],
        });
        const { eventId } = await publishEvent(prisma, { tenantId: 't1', type: 'payment.succeeded', payload: { v: 1, paymentId: 'p1' } });

        expect(prisma.domainEvent.rows).toHaveLength(1);
        expect(prisma.domainEvent.rows[0]).toMatchObject({ id: eventId, tenantId: 't1', type: 'payment.succeeded' });
        const deliveries = prisma.webhookDelivery.rows;
        expect(deliveries.map((d: any) => d.subscriptionId).sort()).toEqual(['s-match', 's-wild']);
        expect(deliveries.every((d: any) => d.status === 'PENDING' && d.tenantId === 't1' && d.eventId === eventId)).toBe(true);
    });

    it('still records a money event when nobody subscribes', async () => {
        const prisma = fakeEventsPrisma();
        await publishEvent(prisma, { tenantId: 't1', type: 'payment.succeeded', payload: { v: 1 } });
        expect(prisma.domainEvent.rows).toHaveLength(1);
        expect(prisma.webhookDelivery.rows).toHaveLength(0);
    });

    it('queries subscriptions scoped by tenantId', async () => {
        const prisma = fakeEventsPrisma();
        await publishEvent(prisma, { tenantId: 't1', type: 'order.created', payload: { v: 1 } });
        expect(prisma.webhookSubscription.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', isActive: true });
    });

    it('uses the caller transaction (no nested $transaction) and delays the nudge until after commit', async () => {
        const prisma = fakeEventsPrisma({ subs: [sub('s1', 't1', ['*'])] });
        const { $transaction, ...txClient } = prisma;
        const nudge = vi.fn(async () => undefined);
        setDeliveryDispatcher(nudge);
        await publishEvent(txClient, { tenantId: 't1', type: 'booking.created', payload: { v: 1 } });
        expect($transaction).not.toHaveBeenCalled();
        expect(nudge).toHaveBeenCalledWith(expect.any(String), TX_NUDGE_DELAY_MS);
    });

    it('with a plain client writes atomically via $transaction and nudges immediately', async () => {
        const prisma = fakeEventsPrisma({ subs: [sub('s1', 't1', ['*'])] });
        const nudge = vi.fn(async () => undefined);
        setDeliveryDispatcher(nudge);
        await publishEvent(prisma, { tenantId: 't1', type: 'booking.created', payload: { v: 1 } });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(nudge).toHaveBeenCalledWith(expect.any(String), 0);
    });

    it('a failing nudge never fails the publish', async () => {
        const prisma = fakeEventsPrisma({ subs: [sub('s1', 't1', ['*'])] });
        setDeliveryDispatcher(async () => { throw new Error('redis down'); });
        await expect(publishEvent(prisma, { tenantId: 't1', type: 'booking.created', payload: { v: 1 } })).resolves.toHaveProperty('eventId');
    });

    it('rejects bad input', async () => {
        const prisma = fakeEventsPrisma();
        await expect(publishEvent(prisma, { tenantId: '', type: 'order.created', payload: {} })).rejects.toThrow(/tenantId/);
        await expect(publishEvent(prisma, { tenantId: 't', type: 'Bad Type!', payload: {} })).rejects.toThrow(/invalid event type/);
        await expect(publishEvent(prisma, { tenantId: 't', type: 'order.created', payload: null as any })).rejects.toThrow(/payload/);
        await expect(publishEvent(prisma, { tenantId: 't', type: 'order.created', payload: [] as any })).rejects.toThrow(/payload/);
        expect(prisma.domainEvent.rows).toHaveLength(0);
    });

    it('test events go to exactly one subscription whatever its filter', async () => {
        const prisma = fakeEventsPrisma({ subs: [sub('s1', 't1', ['booking.created']), sub('s2', 't1', ['*'])] });
        await publishTestEvent(prisma, { tenantId: 't1', subscriptionId: 's1' });
        expect(prisma.webhookDelivery.rows.map((d: any) => d.subscriptionId)).toEqual(['s1']);
        expect(prisma.domainEvent.rows[0].type).toBe('webhook.test');
    });
});

describe('publishEvent storeOnlyIfSubscribed', () => {
    it('writes no DomainEvent when no active subscription matches the type', async () => {
        const prisma = fakeEventsPrisma({
            subs: [sub('s1', 't1', ['booking.created']), sub('s2', 't1', ['message.received'], { isActive: false }), sub('s3', 't2', ['*'])],
        });
        const out = await publishEvent(prisma, { tenantId: 't1', type: 'message.received', payload: { v: 1, text: 'secret' }, storeOnlyIfSubscribed: true });
        expect(out.eventId).toBeNull();
        expect(prisma.domainEvent.create).not.toHaveBeenCalled();
        expect(prisma.webhookDelivery.rows).toHaveLength(0);
    });

    it('stores and fans out when a subscription matches (exact, wildcard, managed external-app)', async () => {
        const prisma = fakeEventsPrisma({
            subs: [sub('s1', 't1', ['message.received']), sub('s2', 't1', ['*']), sub('ext', 't1', ['message.received'], { description: 'external-app' })],
        });
        const out = await publishEvent(prisma, { tenantId: 't1', type: 'message.received', payload: { v: 1 }, storeOnlyIfSubscribed: true });
        expect(out.eventId).toEqual(expect.any(String));
        expect(prisma.domainEvent.rows).toHaveLength(1);
        expect(prisma.webhookDelivery.rows.map((d: any) => d.subscriptionId).sort()).toEqual(['ext', 's1', 's2']);
    });

    it('does not nudge when nothing was written', async () => {
        const prisma = fakeEventsPrisma();
        const nudge = vi.fn(async () => undefined);
        setDeliveryDispatcher(nudge);
        await publishEvent(prisma, { tenantId: 't1', type: 'order.created', payload: { v: 1 }, storeOnlyIfSubscribed: true });
        expect(nudge).not.toHaveBeenCalled();
    });

    it('defaults from the type: high-volume types skip storage, payments/flow/unknown types are kept', async () => {
        const prisma = fakeEventsPrisma();
        for (const type of ['message.received', 'message.sent', 'customer.created', 'customer.updated', 'booking.created', 'booking.cancelled',
            'booking.completed', 'order.created', 'conversation.handoff', 'conversation.resumed']) {
            expect((await publishEvent(prisma, { tenantId: 't1', type, payload: { v: 1 } })).eventId, type).toBeNull();
        }
        expect(prisma.domainEvent.rows).toHaveLength(0);
        for (const type of ['payment.succeeded', 'payment.failed', 'flow.completed', 'x.custom']) {
            expect((await publishEvent(prisma, { tenantId: 't1', type, payload: { v: 1 } })).eventId, type).toEqual(expect.any(String));
        }
        expect(prisma.domainEvent.rows).toHaveLength(4);
    });

    it('an explicit false forces storage of a high-volume type; an explicit true skips a normally stored one', async () => {
        const prisma = fakeEventsPrisma();
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.received', payload: { v: 1 }, storeOnlyIfSubscribed: false })).eventId).toEqual(expect.any(String));
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'payment.failed', payload: { v: 1 }, storeOnlyIfSubscribed: true })).eventId).toBeNull();
    });

    it('persists the dedupeKey on the row', async () => {
        const prisma = fakeEventsPrisma();
        await publishEvent(prisma, { tenantId: 't1', type: 'payment.succeeded', payload: { v: 1 }, dedupeKey: 'k1' });
        expect(prisma.domainEvent.rows[0].dedupeKey).toBe('k1');
    });
});

describe('catalogue', () => {
    it('contains the agreed events, each documented with v: 1', () => {
        for (const t of ['message.received', 'message.sent', 'conversation.handoff', 'conversation.resumed', 'customer.created', 'customer.updated',
            'payment.succeeded', 'payment.failed', 'booking.created', 'booking.cancelled', 'booking.completed', 'order.created', 'flow.completed']) {
            expect(isEventType(t)).toBe(true);
            expect((EVENT_TYPES as any)[t].v).toBe(1);
            expect((EVENT_TYPES as any)[t].fields.v).toBeDefined();
        }
        expect(isEventType('constructor')).toBe(false);
    });

    it('marks the high-volume types fan-out-only and never the money or flow types', () => {
        for (const t of ['message.received', 'message.sent', 'customer.created', 'customer.updated', 'booking.created', 'booking.cancelled',
            'booking.completed', 'order.created', 'conversation.handoff', 'conversation.resumed']) {
            expect(isFanOutOnlyType(t), t).toBe(true);
        }
        for (const t of ['payment.succeeded', 'payment.failed', 'flow.completed', 'webhook.test', 'unknown.type']) {
            expect(isFanOutOnlyType(t), t).toBe(false);
        }
    });
});

describe('billing unit events are always stored', () => {
    beforeEach(() => clearBillingUnitCache());

    it('stores a fan-out-only type with no subscription when it is the tenant\'s billing unit', async () => {
        const prisma = fakeEventsPrisma({ terms: [{ tenantId: 't1', unitEventType: 'booking.created' }] });
        const { eventId } = await publishEvent(prisma, { tenantId: 't1', type: 'booking.created', payload: { v: 1 } });
        expect(eventId).not.toBeNull();
        expect(prisma.domainEvent.rows).toHaveLength(1);
    });

    it('overrides an explicit storeOnlyIfSubscribed: true for the billing unit', async () => {
        const prisma = fakeEventsPrisma({ terms: [{ tenantId: 't1', unitEventType: 'message.sent' }] });
        await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 }, storeOnlyIfSubscribed: true });
        expect(prisma.domainEvent.rows).toHaveLength(1);
    });

    it('still skips a fan-out-only type that is not the billing unit', async () => {
        const prisma = fakeEventsPrisma({ terms: [{ tenantId: 't1', unitEventType: 'booking.created' }] });
        const { eventId } = await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } });
        expect(eventId).toBeNull();
        expect(prisma.domainEvent.rows).toHaveLength(0);
    });

    it('still skips when the tenant has terms without a unit event type, or no terms', async () => {
        const prisma = fakeEventsPrisma({ terms: [{ tenantId: 't1', unitEventType: null }] });
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } })).eventId).toBeNull();
        expect((await publishEvent(prisma, { tenantId: 't9', type: 'message.sent', payload: { v: 1 } })).eventId).toBeNull();
    });

    it('is per tenant: another tenant\'s billing unit does not force storage here', async () => {
        const prisma = fakeEventsPrisma({ terms: [{ tenantId: 't2', unitEventType: 'message.sent' }] });
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } })).eventId).toBeNull();
    });

    it('looks the terms up by tenantId only on the skip path (never for subscribed or stored-anyway events)', async () => {
        const prisma = fakeEventsPrisma({ subs: [sub('s1', 't1', ['*'])] });
        await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } });
        await publishEvent(prisma, { tenantId: 't1', type: 'payment.succeeded', payload: { v: 1 } });
        expect(prisma.billingTerms.findUnique).not.toHaveBeenCalled();
    });

    it('caches the lookup briefly, and clearBillingUnitCache picks up a change', async () => {
        const prisma = fakeEventsPrisma();
        await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } });
        await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } });
        expect(prisma.billingTerms.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.billingTerms.findUnique.mock.calls[0][0].where).toEqual({ tenantId: 't1' });

        prisma.billingTerms.rows.push({ tenantId: 't1', unitEventType: 'message.sent' });
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } })).eventId).toBeNull(); // stale, within TTL
        clearBillingUnitCache('t1');
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } })).eventId).not.toBeNull();
    });

    it('expires the cache after the TTL', async () => {
        vi.useFakeTimers();
        try {
            const prisma = fakeEventsPrisma();
            await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } });
            prisma.billingTerms.rows.push({ tenantId: 't1', unitEventType: 'message.sent' });
            vi.advanceTimersByTime(BILLING_UNIT_CACHE_TTL_MS + 1);
            expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } })).eventId).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails safe: if the terms lookup errors, the event is stored (a count is never silently lost)', async () => {
        const prisma = fakeEventsPrisma();
        prisma.billingTerms.findUnique.mockRejectedValueOnce(new Error('db blip'));
        const { eventId } = await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } });
        expect(eventId).not.toBeNull();
        // and the failure is not cached: the next publish looks again
        expect((await publishEvent(prisma, { tenantId: 't1', type: 'message.sent', payload: { v: 1 } })).eventId).toBeNull();
    });
});
