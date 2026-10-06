/**
 * Column-existence sweep, part 1: conversations, customers, notifications.
 *
 * These functions take `prisma: any` (or a structural type), so tsc cannot tell
 * when they write a column that does not exist (the takeoverAt bug lived for
 * months that way). Each test drives the function against the real schema and
 * asserts on the ROWS afterwards, never just "did not throw": several of these
 * call sites swallow errors (`.catch(() => undefined)`) so a bad column would
 * otherwise pass silently.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedBooking, seedConversation, seedService, seedTenant, seedUser } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { silentLogger } from './helpers/fake-fastify.js';
import { assignConversation, getPendingTakeovers, resumeBot, triggerTakeover } from '../../src/services/human-takeover.js';
import { resolveConversation } from '../../src/services/conversation-resolver.js';
import {
    findCustomerEmail, linkConversationToCustomer, resolveCustomerEmail, resolveCustomerIdSafe, upsertCustomerByPhone,
} from '../../src/services/customers.js';
import { createNotification } from '../../src/services/notifications.js';
import { reminderStillApplies } from '../../src/services/notification-purposes.js';
import { releaseExpiredHolds } from '../../src/services/hold-expiry.js';
import { HOLD_MINUTES } from '../../src/services/booking-deposit.js';
import { buildCustomerMemory } from '../../src/services/customer-memory.js';
import { holdingSentRecently } from '../../src/routes/whatsapp/system-message.js';
import { externalAppIsLive } from '../../src/routes/whatsapp/inbound-events.js';
import { emitConversationHandoff } from '../../src/services/events/emit.js';

describe('human takeover (the takeoverAt regression)', () => {
    let tenantId: string; let conversationId: string; let userId: string;
    beforeEach(async () => {
        tenantId = (await seedTenant()).id;
        userId = (await seedUser(tenantId)).id;
        conversationId = (await seedConversation(tenantId)).id;
    });

    it('triggerTakeover writes state, reason and takeoverAt, and records the handoff event for subscribers', async () => {
        const prisma = await guardedPrisma();
        await rawPrisma().webhookSubscription.create({ data: { tenantId, url: 'https://example.test/h', events: ['conversation.handoff'], secretEnc: 'x' } });
        await triggerTakeover(prisma, conversationId, 'asked_for_human');
        const row = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conversationId } });
        expect(row.state).toBe('HUMAN_ACTIVE');
        expect(row.takeoverReason).toBe('asked_for_human');
        expect(row.takeoverAt).toBeInstanceOf(Date);
        const events = await rawPrisma().domainEvent.findMany({ where: { tenantId, type: 'conversation.handoff' } });
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({ conversationId, reason: 'asked_for_human' });
    });

    it('getPendingTakeovers orders by takeoverAt and includes recent messages', async () => {
        const prisma = await guardedPrisma();
        const c2 = (await seedConversation(tenantId)).id;
        await triggerTakeover(prisma, c2, 'first');
        await new Promise((r) => setTimeout(r, 10));
        await triggerTakeover(prisma, conversationId, 'second');
        await rawPrisma().message.create({ data: { conversationId: c2, direction: 'INBOUND', content: 'help' } });
        const pending = await getPendingTakeovers(prisma, tenantId);
        expect(pending.map((c: any) => c.id)).toEqual([c2, conversationId]);
        expect(pending[0].messages).toHaveLength(1);
    });

    it('assignConversation then resumeBot clear and set the right columns', async () => {
        const prisma = await guardedPrisma();
        await triggerTakeover(prisma, conversationId, 'r');
        expect(await assignConversation(prisma, conversationId, userId)).toEqual({ success: true });
        let row = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conversationId } });
        expect(row.assignedUserId).toBe(userId);
        expect(row.assignedAt).toBeInstanceOf(Date);
        expect(await assignConversation(prisma, conversationId, userId)).toEqual({ success: false, error: 'Conversation already assigned' });

        await rawPrisma().conversation.update({ where: { id: conversationId }, data: { botFailureCount: 3 } });
        expect(await resumeBot(prisma, conversationId, userId)).toEqual({ success: true });
        row = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conversationId } });
        expect(row).toMatchObject({ state: 'BOT_ACTIVE', botFailureCount: 0, assignedUserId: null, takeoverReason: null, takeoverAt: null });
        expect((await resumeBot(prisma, conversationId, userId)).success).toBe(false);
        expect(await rawPrisma().domainEvent.count({ where: { type: 'conversation.resumed' } })).toBe(0); // fan-out only, no subscriber
    });

    it('emitConversationHandoff stores the event when a wildcard subscriber exists', async () => {
        const prisma = await guardedPrisma();
        await rawPrisma().webhookSubscription.create({ data: { tenantId, url: 'https://example.test/h', events: ['*'], secretEnc: 'x' } });
        await emitConversationHandoff(prisma, { tenantId, conversationId, to: 'APP' });
        expect(await rawPrisma().webhookDelivery.count({ where: { tenantId } })).toBe(1);
    });
});

describe('conversation resolver', () => {
    let tenantId: string;
    beforeEach(async () => { tenantId = (await seedTenant()).id; });
    const args = (over: Record<string, unknown> = {}) => ({ tenantId, channel: 'WHATSAPP' as const, externalId: '233200000001', customerPhone: '+233200000001', ...over });

    it('creates on first contact and backfills missing details without erasing known ones', async () => {
        const prisma = await guardedPrisma();
        const first = await resolveConversation(prisma, args());
        expect(first.created).toBe(true);
        expect(first.customerName).toBeNull();
        const second = await resolveConversation(prisma, args({ customerName: 'Kofi', customerHandle: '@kofi' }));
        expect(second).toMatchObject({ id: first.id, created: false, customerName: 'Kofi' });
        const third = await resolveConversation(prisma, args({ customerName: 'Other', customerHandle: null }));
        expect(third.customerName).toBe('Kofi');
        const row = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: first.id } });
        expect(row).toMatchObject({ customerName: 'Kofi', customerHandle: '@kofi', state: 'BOT_ACTIVE', contextVersion: 0 });
    });

    it('is keyed per (tenant, channel, externalId)', async () => {
        const prisma = await guardedPrisma();
        const other = (await seedTenant()).id;
        const a = await resolveConversation(prisma, args());
        const b = await resolveConversation(prisma, args({ channel: 'MESSENGER' }));
        const c = await resolveConversation(prisma, args({ tenantId: other }));
        expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    });

    // Contract test: two deliveries of a brand-new sender's first messages must
    // both resolve to the same conversation. resolveConversation does
    // find-then-create without handling the P2002 a lost race raises.
    it('concurrent first contacts resolve to one conversation without throwing', async () => {
        const prisma = await guardedPrisma();
        await Promise.all(Array.from({ length: 20 }, () => prisma.tenant.count()));
        const { ok, failed } = await race(8, () => resolveConversation(prisma, args({ externalId: '233200000777' })));
        expect(failed.map((e) => `${e?.code}`)).toEqual([]);
        expect(new Set(ok.map((r) => r.id)).size).toBe(1);
        expect(await rawPrisma().conversation.count({ where: { tenantId, externalId: '233200000777' } })).toBe(1);
    });
});

describe('customers', () => {
    let tenantId: string;
    beforeEach(async () => { tenantId = (await seedTenant()).id; });

    it('upserts by normalised phone, fills only missing name/email, and is concurrency-safe', async () => {
        const prisma = await guardedPrisma();
        const { ok, failed } = await race(8, () => upsertCustomerByPhone(prisma, { tenantId, phone: '+233241234567', name: 'Ama' }));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(new Set(ok.map((c) => c!.id)).size).toBe(1);
        expect(await rawPrisma().customer.count({ where: { tenantId } })).toBe(1);

        const again = await upsertCustomerByPhone(prisma, { tenantId, phone: '+233241234567', name: 'Different', email: 'ama@example.test' });
        expect(again).toMatchObject({ name: 'Ama', email: 'ama@example.test' });
        expect(await upsertCustomerByPhone(prisma, { tenantId, phone: 'garbage' })).toBeNull();
    });

    it('creating a customer stores customer.created once for a subscriber', async () => {
        const prisma = await guardedPrisma();
        await rawPrisma().webhookSubscription.create({ data: { tenantId, url: 'https://example.test/h', events: ['customer.created'], secretEnc: 'x' } });
        await upsertCustomerByPhone(prisma, { tenantId, phone: '+233241230000' });
        await upsertCustomerByPhone(prisma, { tenantId, phone: '+233241230000' });
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'customer.created' } })).toBe(1);
    });

    it('resolveCustomerIdSafe returns the id and swallows nothing silently for good input', async () => {
        const prisma = await guardedPrisma();
        const id = await resolveCustomerIdSafe(prisma, { tenantId, phone: '+233241230001' }, silentLogger);
        expect(id).toBeTruthy();
        expect((await rawPrisma().customer.findUniqueOrThrow({ where: { id: id! } })).tenantId).toBe(tenantId);
    });

    it('links a conversation only within the same tenant', async () => {
        const prisma = await guardedPrisma();
        const other = (await seedTenant()).id;
        const customer = (await upsertCustomerByPhone(prisma, { tenantId, phone: '+233241230002' }))!;
        const conv = await seedConversation(tenantId);
        const foreignConv = await seedConversation(other);
        expect(await linkConversationToCustomer(prisma, { tenantId, conversationId: conv.id, customerId: customer.id })).toBe(true);
        expect(await linkConversationToCustomer(prisma, { tenantId: other, conversationId: foreignConv.id, customerId: customer.id })).toBe(false);
        expect(await linkConversationToCustomer(prisma, { tenantId, conversationId: foreignConv.id, customerId: customer.id })).toBe(false);
        expect((await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conv.id } })).customerId).toBe(customer.id);
        expect((await rawPrisma().conversation.findUniqueOrThrow({ where: { id: foreignConv.id } })).customerId).toBeNull();
    });

    it('email resolution: latest booking wins for booking purposes, customer record is the fallback', async () => {
        const prisma = await guardedPrisma();
        const customer = (await upsertCustomerByPhone(prisma, { tenantId, phone: '+233241230003', email: 'record@example.test' }))!;
        expect(await findCustomerEmail(prisma, { tenantId, customerId: customer.id })).toBe('record@example.test');
        expect(await findCustomerEmail(prisma, { tenantId, phone: '0241230003' })).toBeNull(); // no business number -> cannot complete a local number
        expect(await findCustomerEmail(prisma, { tenantId, phone: '+233241230003' })).toBe('record@example.test');
        const svc = await seedService(tenantId);
        await seedBooking(tenantId, svc.id, { customerPhone: '+233241230003', customerEmail: 'booking@example.test' });
        expect(await resolveCustomerEmail(prisma, { tenantId, purpose: 'BOOKING_CONFIRMATION', customerPhone: '+233241230003' }))
            .toEqual({ email: 'booking@example.test', source: 'booking' });
        expect(await resolveCustomerEmail(prisma, { tenantId, purpose: 'ORDER_CONFIRMATION', customerPhone: '+233241230003' }))
            .toEqual({ email: 'record@example.test', source: 'customer' });
    });
});

describe('notifications, reminders, holds, memory', () => {
    let tenantId: string; let serviceId: string;
    beforeEach(async () => {
        tenantId = (await seedTenant()).id;
        serviceId = (await seedService(tenantId)).id;
    });

    it('createNotification persists type/title/message/metadata', async () => {
        const prisma = await guardedPrisma();
        await createNotification(prisma, { tenantId, type: 'SYSTEM', title: 'T', message: 'M', metadata: { kind: 'x', n: 1 } });
        const row = await rawPrisma().notification.findFirstOrThrow({ where: { tenantId } });
        expect(row).toMatchObject({ type: 'SYSTEM', title: 'T', message: 'M', metadata: { kind: 'x', n: 1 } });
    });

    it('reminderStillApplies is tenant-scoped and status-aware', async () => {
        const prisma = await guardedPrisma();
        const other = (await seedTenant()).id;
        const confirmed = await seedBooking(tenantId, serviceId, { status: 'CONFIRMED' });
        const cancelled = await seedBooking(tenantId, serviceId, { status: 'CANCELLED' });
        expect(await reminderStillApplies(prisma, { entityType: 'booking', entityId: confirmed.id, tenantId })).toBe('applies');
        expect(await reminderStillApplies(prisma, { entityType: 'booking', entityId: cancelled.id, tenantId })).toBe('skip');
        expect(await reminderStillApplies(prisma, { entityType: 'booking', entityId: confirmed.id, tenantId: other })).toBe('skip');
        expect(await reminderStillApplies(prisma, { entityType: 'nope', entityId: 'x', tenantId })).toBe('unknown_entity');
    });

    it('releaseExpiredHolds cancels only stale unpaid holds, notes them and notifies', async () => {
        const prisma = await guardedPrisma();
        const stale = await seedBooking(tenantId, serviceId, { status: 'PENDING_PAYMENT', notes: 'walk-in' });
        const fresh = await seedBooking(tenantId, serviceId, { status: 'PENDING_PAYMENT' });
        const paid = await seedBooking(tenantId, serviceId, { status: 'PENDING_PAYMENT', paymentStatus: 'PAID' });
        await rawPrisma().booking.updateMany({
            where: { id: { in: [stale.id, paid.id] } },
            data: { createdAt: new Date(Date.now() - (HOLD_MINUTES + 5) * 60_000) },
        });
        expect(await releaseExpiredHolds(prisma, undefined)).toBe(1);
        const rows = Object.fromEntries((await rawPrisma().booking.findMany()).map((b) => [b.id, b]));
        expect(rows[stale.id].status).toBe('CANCELLED');
        expect(rows[stale.id].notes).toContain('walk-in');
        expect(rows[stale.id].notes).toContain('Released');
        expect(rows[fresh.id].status).toBe('PENDING_PAYMENT');
        expect(rows[paid.id].status).toBe('PENDING_PAYMENT');
        const n = await rawPrisma().notification.findMany({ where: { tenantId } });
        expect(n).toHaveLength(1);
        expect(n[0].type).toBe('BOOKING_CANCELLED');
    });

    it('buildCustomerMemory reads bookings, orders and conversations for the phone', async () => {
        const prisma = await guardedPrisma();
        await seedBooking(tenantId, serviceId, {
            status: 'COMPLETED', customerPhone: '+233241230004', customerName: 'Efua',
            startTime: new Date(Date.now() - 5 * 86_400_000), endTime: new Date(Date.now() - 5 * 86_400_000 + 3600_000),
        });
        await seedConversation(tenantId, { customerPhone: '+233241230004', customerName: 'Efua' });
        const mem = await buildCustomerMemory(prisma, tenantId, '+233241230004');
        expect(mem.isReturning).toBe(true);
        expect(mem.summary).toContain('Efua');
        expect(mem.summary).toContain('Haircut');
        expect((await buildCustomerMemory(prisma, tenantId, '+233299999999')).summary).toBe('');
    });

    it('holdingSentRecently matches the JSON metadata path on real Postgres', async () => {
        const prisma = await guardedPrisma();
        const conv = await seedConversation(tenantId);
        expect(await holdingSentRecently(prisma, conv.id)).toBe(false);
        await rawPrisma().message.create({ data: { conversationId: conv.id, direction: 'OUTBOUND', content: 'one moment', metadata: { kind: 'retry' } } });
        expect(await holdingSentRecently(prisma, conv.id)).toBe(false);
        await rawPrisma().message.create({ data: { conversationId: conv.id, direction: 'OUTBOUND', content: 'one moment', metadata: { kind: 'holding' } } });
        expect(await holdingSentRecently(prisma, conv.id)).toBe(true);
    });

    it('externalAppIsLive reflects the ExternalApp row', async () => {
        const prisma = await guardedPrisma();
        expect(await externalAppIsLive(prisma, tenantId)).toBe(false);
        await rawPrisma().externalApp.create({ data: { tenantId, name: 'Turbo', url: 'https://example.test/a', signingSecretEnc: 'x', isActive: true } });
        expect(await externalAppIsLive(prisma, tenantId)).toBe(true);
    });
});
