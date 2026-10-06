import { beforeEach, describe, expect, it } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedTenant } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { publishEventOnce } from '../../src/services/events/emit.js';
import { republishPaymentSucceeded } from '../../src/services/payment-fulfillment.js';
import { silentLogger } from './helpers/fake-fastify.js';

const input = (tenantId: string) => ({ tenantId, type: 'payment.succeeded', payload: { reference: 'r1', amount: 1000 } });
const dedupe = { field: 'reference', equals: 'r1' };

describe('publishEventOnce on a real database', () => {
    let a: string; let b: string;
    beforeEach(async () => { a = (await seedTenant()).id; b = (await seedTenant()).id; });

    it('concurrent once-publishes write exactly one row', async () => {
        const prisma = await guardedPrisma();
        const { ok, failed } = await race(12, () => publishEventOnce(prisma, input(a), dedupe));
        expect(failed).toEqual([]);
        expect(ok.filter((r) => r === 'published')).toHaveLength(1);
        expect(ok.filter((r) => r === 'duplicate')).toHaveLength(11);
        const rows = await rawPrisma().domainEvent.findMany({ where: { tenantId: a } });
        expect(rows).toHaveLength(1);
        expect(rows[0].dedupeKey).toBe('payment.succeeded:reference:r1');
        expect(rows[0].payload).toMatchObject({ v: 1, reference: 'r1' });
    });

    it('the same key for different tenants is allowed for both', async () => {
        const prisma = await guardedPrisma();
        const { ok, failed } = await race(2, (i) => publishEventOnce(prisma, input(i === 0 ? a : b), dedupe));
        expect(failed).toEqual([]);
        expect(ok).toEqual(['published', 'published']);
        expect(await rawPrisma().domainEvent.count()).toBe(2);
    });

    it('a different dedupe value is a different event', async () => {
        const prisma = await guardedPrisma();
        expect(await publishEventOnce(prisma, input(a), { field: 'reference', equals: 'r1' })).toBe('published');
        expect(await publishEventOnce(prisma, input(a), { field: 'reference', equals: 'r2' })).toBe('published');
        expect(await publishEventOnce(prisma, input(a), { field: 'reference', equals: 'r1' })).toBe('duplicate');
        expect(await rawPrisma().domainEvent.count({ where: { tenantId: a } })).toBe(2);
    });

    it('fans out exactly one delivery per matching subscription, even when raced', async () => {
        const prisma = await guardedPrisma();
        const db = rawPrisma();
        const sub = await db.webhookSubscription.create({ data: { tenantId: a, url: 'https://example.test/hook', events: ['payment.succeeded'], secretEnc: 'x' } });
        await db.webhookSubscription.create({ data: { tenantId: a, url: 'https://example.test/other', events: ['booking.created'], secretEnc: 'x' } });
        await race(6, () => publishEventOnce(prisma, input(a), dedupe));
        const deliveries = await db.webhookDelivery.findMany({ where: { tenantId: a } });
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].subscriptionId).toBe(sub.id);
        expect(deliveries[0].status).toBe('PENDING');
    });

    it('a fan-out-only type with no subscriber writes nothing and reports skipped', async () => {
        const prisma = await guardedPrisma();
        const r = await publishEventOnce(prisma, { tenantId: a, type: 'message.received', payload: { messageId: 'm1' } }, { field: 'messageId', equals: 'm1' });
        expect(r).toBe('skipped');
        expect(await rawPrisma().domainEvent.count()).toBe(0);
    });

    it('republishPaymentSucceeded under concurrency: one event, null error for every caller', async () => {
        const prisma = await guardedPrisma();
        const { ok } = await race(6, () => republishPaymentSucceeded({
            prisma, logger: silentLogger, tenantId: a, reference: 'r9', amountMinor: 2500, currency: 'GHS', extra: { bookingId: 'b1' },
        }));
        expect(ok).toEqual([null, null, null, null, null, null]);
        expect(await rawPrisma().domainEvent.count({ where: { tenantId: a, type: 'payment.succeeded' } })).toBe(1);
    });
});
