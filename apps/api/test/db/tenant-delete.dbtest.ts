/**
 * Permanent organisation delete on real Postgres (routes/admin/tenant-lifecycle.ts,
 * services/tenant-lifecycle.ts), through the REAL guarded client:
 *  - an inactive organisation without money history is removed completely:
 *    every table with a tenantId column has zero rows for it, and the rows
 *    hanging off it without a tenantId (messages, order items, calendar
 *    events, ledger entries) are gone too, with no FK failure (Booking ->
 *    Service and OrderItem -> Product are RESTRICT);
 *  - the `tenant.deleted` audit row, older audit rows and its alerts survive;
 *  - another organisation's rows are untouched;
 *  - an organisation with a ledger movement, a paid booking or a paid ride
 *    pass, or an open payment link (held booking or ride pass), is refused,
 *    even when the delete is called directly, and keeps
 *    every row.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rawPrisma, guardedPrisma } from './helpers/db.js';
import { seedBooking, seedConversation, seedFundedWallet, seedService, seedTenant, seedUser, seedWallet } from './helpers/seed.js';
import { checkTenantDeletion, deleteTenantPermanently } from '../../src/services/tenant-lifecycle.js';

const uid = () => randomUUID().replace(/-/g, '').slice(0, 10);

/** Every table with a "tenantId" column, except the two that are kept on purpose. */
async function tenantTables(): Promise<string[]> {
    const rows = await rawPrisma().$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND column_name = 'tenantId'
          ORDER BY table_name`,
    );
    return rows.map((r) => r.table_name).filter((t) => t !== 'AuditLog' && t !== 'PlatformAlert');
}

async function rowsFor(tenantId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of await tenantTables()) {
        const [{ n }] = await rawPrisma().$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}" WHERE "tenantId" = $1`, tenantId);
        out[t] = Number(n);
    }
    return out;
}

/** A busy organisation with NO payments: every kind of row the product writes. */
async function seedBusyTenant(opts: { isActive?: boolean } = {}) {
    const db = rawPrisma();
    const tenant = await seedTenant({ isActive: opts.isActive ?? false, vertical: 'RIDES' });
    const id = tenant.id;
    const owner = await seedUser(id);
    await seedUser(id, { role: 'STAFF' });
    await db.deviceToken.create({ data: { userId: owner.id, tenantId: id, token: `ExponentPushToken[${uid()}]`, platform: 'ios' } });

    const customer = await db.customer.create({ data: { tenantId: id, phone: `+23324${Math.floor(Math.random() * 1e7)}`, name: 'Ama' } });
    const conversation = await seedConversation(id, { customerId: customer.id });
    await db.message.createMany({
        data: [
            { conversationId: conversation.id, direction: 'INBOUND', content: 'Hi', whatsappMsgId: `wamid.${uid()}` },
            { conversationId: conversation.id, direction: 'OUTBOUND', content: 'Hello!' },
        ],
    });

    const service = await seedService(id);
    // UNPAID booking whose hold already lapsed (the sweeper cancelled it): not an open link.
    await seedBooking(id, service.id, { customerId: customer.id, status: 'CANCELLED' });
    const product = await db.product.create({ data: { tenantId: id, name: 'Jollof', price: 30 } });
    await db.order.create({
        data: {
            tenantId: id, orderRef: `OR-${uid()}`, customerName: 'Ama', customerPhone: customer.phone, totalAmount: 30,
            items: { create: [{ productId: product.id, quantity: 1, unitPrice: 30 }] },
        },
    });
    await db.workingHours.create({ data: { tenantId: id, dayOfWeek: 1, startTime: '09:00', endTime: '17:00' } });
    await db.blackoutDate.create({ data: { tenantId: id, date: new Date('2026-12-25') } });
    const integration = await db.calendarIntegration.create({ data: { tenantId: id, provider: 'GOOGLE', accessToken: 'enc' } });
    await db.calendarEvent.create({
        data: { calendarIntegrationId: integration.id, externalEventId: `ev-${uid()}`, startTime: new Date(), endTime: new Date(Date.now() + 3600_000) },
    });

    // Rides: settings, destination, driver, an UNPAID pass with an adjustment entry, a package ride, PAYG capacity.
    await db.rideSettings.create({ data: { tenantId: id } });
    await db.rideDestination.create({ data: { tenantId: id, label: 'Airport', latitude: 5.6, longitude: -0.17 } });
    const driver = await db.driver.create({ data: { tenantId: id, name: 'Kofi', phone: '+233200000000', vehicle: 'Corolla', plate: 'GR-1' } });
    const pass = await db.ridePass.create({
        data: { tenantId: id, customerId: customer.id, ridesTotal: 60, validityDays: 30, maxKm: 15, priceMinor: 60000, currency: 'GHS', status: 'CANCELLED', cancelReason: 'hold_expired', holdExpiresAt: new Date(Date.now() - 600_000) },
    });
    await db.ridePassEntry.create({ data: { tenantId: id, passId: pass.id, type: 'ADJUSTMENT', delta: 0, note: 'test' } });
    await db.ride.create({
        data: {
            tenantId: id, ref: `TR-${uid()}`, kind: 'PACKAGE', status: 'REQUESTED', customerId: customer.id, passId: pass.id, driverId: driver.id,
            pickupLabel: 'Home', pickupLat: 5.6, pickupLng: -0.2, destinationLabel: 'Airport', destinationLat: 5.6, destinationLng: -0.17,
            distanceKm: 8, currency: 'GHS',
        },
    });
    await db.paygDay.create({ data: { tenantId: id, day: '2026-10-07', used: 1 } });

    // Flows, developer surface, events, notifications, usage, templates, billing.
    await db.flowDefinition.create({ data: { tenantId: id, key: 'main', version: 1, definition: { steps: [] } } });
    await db.apiKey.create({ data: { tenantId: id, name: 'POS', prefix: `bk_${uid()}`, secretHash: 'h' } });
    await db.externalApp.create({ data: { tenantId: id, name: 'App', url: 'https://example.test/hook', signingSecretEnc: 'enc' } });
    const sub = await db.webhookSubscription.create({ data: { tenantId: id, url: 'https://example.test/wh', secretEnc: 'enc' } });
    const event = await db.domainEvent.create({ data: { tenantId: id, type: 'message.received', payload: { a: 1 }, dedupeKey: `k-${uid()}` } });
    await db.webhookDelivery.create({ data: { tenantId: id, subscriptionId: sub.id, eventId: event.id } });
    await db.notification.create({ data: { tenantId: id, type: 'SYSTEM', title: 'Hi', message: 'Hello' } });
    await db.tenantUsage.create({ data: { tenantId: id, month: '2026-10', messageCount: 3 } });
    await db.messageTemplate.create({ data: { tenantId: id, name: `t_${uid()}`, category: 'UTILITY', purpose: 'BOOKING_CONFIRMATION' } });
    await db.billingTerms.create({ data: { tenantId: id } });
    const promo = await db.promoCode.create({ data: { code: `P${uid().toUpperCase()}`, kind: 'TRIAL_EXTENSION', days: 7 } });
    await db.promoRedemption.create({ data: { promoCodeId: promo.id, tenantId: id } });
    const admin = await db.admin.create({ data: { email: `${uid()}@bookly.test`, name: 'Ada', passwordHash: 'x' } });
    await db.supportSession.create({ data: { adminId: admin.id, tenantId: id, reason: 'help', expiresAt: new Date(Date.now() + 600_000) } });
    await db.payoutRecipient.create({
        data: { tenantId: id, type: 'mobile_money', accountName: 'Ama', accountNumberEnc: 'enc', accountNumberMasked: '024 ••• 4567', bankCode: 'MTN', usableFrom: new Date() },
    });
    await seedWallet(id); // zero balance, no ledger: not money history

    // Kept on purpose: earlier audit history and an open alert.
    await db.auditLog.create({ data: { tenantId: id, actorType: 'USER', actorId: owner.id, action: 'auth.login.success' } });
    await db.platformAlert.create({ data: { tenantId: id, kind: 'whatsapp.quality_low', severity: 'warning', message: 'low', dedupeKey: `a-${uid()}` } });

    return { tenant, admin, conversation, integration };
}

describe('permanent organisation delete', () => {
    it('removes every row of an inactive organisation without money history, keeps its audit trail, and leaves others alone', async () => {
        const db = rawPrisma();
        const { tenant, admin, conversation, integration } = await seedBusyTenant();
        const other = await seedBusyTenant({ isActive: true });
        const before = await rowsFor(tenant.id);
        // The seed really did touch the tables this test is about.
        for (const t of ['User', 'Conversation', 'Customer', 'Booking', 'Order', 'Ride', 'RidePass', 'RidePassEntry', 'FlowDefinition', 'ApiKey', 'WebhookSubscription', 'WebhookDelivery', 'Notification', 'DeviceToken', 'PayoutRecipient']) {
            expect(before[t], t).toBeGreaterThan(0);
        }
        const otherBefore = await rowsFor(other.tenant.id);

        const prisma = await guardedPrisma();
        const check = await checkTenantDeletion(prisma, tenant.id);
        expect(check).toMatchObject({ canDelete: true, blockers: [] });
        expect(check!.counts).toMatchObject({ users: 2, conversations: 1, messages: 2, customers: 1, bookings: 1, orders: 1, rides: 1, passes: 1, flows: 1, apiKeys: 1, webhookSubscriptions: 1, notifications: 1, ledgerMovements: 0 });

        const out = await deleteTenantPermanently(prisma, {
            tenantId: tenant.id, adminId: admin.id, reason: 'Closed the business', ipAddress: '127.0.0.1', cleanup: { whatsapp: 'none' },
        });
        expect(out.ok).toBe(true);

        expect(await db.tenant.findUnique({ where: { id: tenant.id } })).toBeNull();
        const after = await rowsFor(tenant.id);
        expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
        // Rows with no tenantId column of their own.
        expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(0);
        expect(await db.calendarEvent.count({ where: { calendarIntegrationId: integration.id } })).toBe(0);
        expect(await db.orderItem.count({ where: { order: { tenantId: tenant.id } } })).toBe(0);

        // Kept: the audit trail, including the delete itself, and the (now resolved) alert.
        const audits = await db.auditLog.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
        expect(audits.map((a) => a.action)).toEqual(['auth.login.success', 'tenant.deleted']);
        expect(audits[1]).toMatchObject({ actorType: 'ADMIN', actorId: admin.id, targetType: 'Tenant', targetId: tenant.id });
        expect(audits[1].metadata).toMatchObject({
            name: tenant.name, reason: 'Closed the business', cleanup: { whatsapp: 'none' },
            counts: expect.objectContaining({ users: 2, messages: 2 }),
        });
        const alerts = await db.platformAlert.findMany({ where: { tenantId: tenant.id } });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].resolvedAt).toBeInstanceOf(Date);

        // The other organisation is exactly as it was.
        expect(await rowsFor(other.tenant.id)).toEqual(otherBefore);
        expect(await db.message.count({ where: { conversationId: other.conversation.id } })).toBe(2);
        expect(await db.calendarEvent.count({ where: { calendarIntegrationId: other.integration.id } })).toBe(1);
    });

    it('refuses an active organisation', async () => {
        const { tenant, admin } = await seedBusyTenant({ isActive: true });
        const out = await deleteTenantPermanently(await guardedPrisma(), { tenantId: tenant.id, adminId: admin.id, reason: 'x x x', ipAddress: null, cleanup: {} });
        expect(out).toMatchObject({ ok: false, reason: 'blocked', blockers: [expect.objectContaining({ code: 'NOT_DEACTIVATED' })] });
        expect(await rawPrisma().tenant.findUnique({ where: { id: tenant.id } })).not.toBeNull();
    });

    const moneyCases: Array<[string, (tenantId: string) => Promise<unknown>]> = [
        ['a ledger movement', async (tenantId) => seedFundedWallet(tenantId, { availableMinor: 5000 })],
        ['a paid booking', async (tenantId) => {
            const s = await seedService(tenantId);
            return seedBooking(tenantId, s.id, { status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date() });
        }],
        ['a paid ride pass', async (tenantId) => {
            const c = await rawPrisma().customer.create({ data: { tenantId, phone: `+23320${Math.floor(Math.random() * 1e7)}` } });
            return rawPrisma().ridePass.create({
                data: { tenantId, customerId: c.id, ridesTotal: 60, validityDays: 30, maxKm: 15, priceMinor: 60000, currency: 'GHS', status: 'ACTIVE', paidAt: new Date(), paidAmountMinor: 60000 },
            });
        }],
    ];

    const openLinkCases: Array<[string, (tenantId: string) => Promise<unknown>]> = [
        ['a booking waiting on its deposit', async (tenantId) => {
            const s = await seedService(tenantId);
            return seedBooking(tenantId, s.id); // PENDING_PAYMENT, UNPAID, with a payment reference
        }],
        ['a held ride pass', async (tenantId) => {
            const c = await rawPrisma().customer.create({ data: { tenantId, phone: `+23320${Math.floor(Math.random() * 1e7)}` } });
            return rawPrisma().ridePass.create({
                data: { tenantId, customerId: c.id, ridesTotal: 60, validityDays: 30, maxKm: 15, priceMinor: 60000, currency: 'GHS', status: 'HELD', holdExpiresAt: new Date(Date.now() + 600_000) },
            });
        }],
    ];

    it.each(openLinkCases)('refuses an inactive organisation with %s (open payment link) and keeps every row', async (_label, addLink) => {
        const db = rawPrisma();
        const tenant = await seedTenant({ isActive: false });
        await addLink(tenant.id);
        const admin = await db.admin.create({ data: { email: `${uid()}@bookly.test`, name: 'Ada', passwordHash: 'x' } });
        const before = await rowsFor(tenant.id);

        const prisma = await guardedPrisma();
        const check = await checkTenantDeletion(prisma, tenant.id);
        expect(check!.blockers).toEqual([expect.objectContaining({ code: 'OPEN_PAYMENT_LINKS', count: 1 })]);
        const out = await deleteTenantPermanently(prisma, { tenantId: tenant.id, adminId: admin.id, reason: 'x x x', ipAddress: null, cleanup: {} });
        expect(out).toMatchObject({ ok: false, reason: 'blocked', blockers: [expect.objectContaining({ code: 'OPEN_PAYMENT_LINKS' })] });
        expect(await db.tenant.findUnique({ where: { id: tenant.id } })).not.toBeNull();
        expect(await rowsFor(tenant.id)).toEqual(before);
    });

    it.each(moneyCases)('refuses an inactive organisation with %s, even called directly, and keeps every row', async (_label, addMoney) => {
        const db = rawPrisma();
        const tenant = await seedTenant({ isActive: false });
        await seedUser(tenant.id);
        await addMoney(tenant.id);
        const admin = await db.admin.create({ data: { email: `${uid()}@bookly.test`, name: 'Ada', passwordHash: 'x' } });
        const before = await rowsFor(tenant.id);

        const prisma = await guardedPrisma();
        const check = await checkTenantDeletion(prisma, tenant.id);
        expect(check!.canDelete).toBe(false);
        expect(check!.blockers.map((b) => b.code)).toEqual(['MONEY_HISTORY']);

        const out = await deleteTenantPermanently(prisma, { tenantId: tenant.id, adminId: admin.id, reason: 'x x x', ipAddress: null, cleanup: {} });
        expect(out).toMatchObject({ ok: false, reason: 'blocked' });
        expect(await db.tenant.findUnique({ where: { id: tenant.id } })).not.toBeNull();
        expect(await rowsFor(tenant.id)).toEqual(before);
        expect(await db.auditLog.count({ where: { action: 'tenant.deleted', targetId: tenant.id } })).toBe(0);
    });
});
