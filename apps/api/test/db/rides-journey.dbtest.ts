/**
 * E1: TURBO's whole journey on a real database, through the real seams:
 *   WhatsApp turn handler (handleWithFlow) -> flow engine -> turbo.* actions
 *   -> payment link (Paystack initialize mocked) -> webhook dispatch with a
 *   verified charge (verify mocked) -> ride_package fulfiller -> console API
 *   (real auth plugin + /rides routes) -> customer messages (channel send mocked)
 *   -> app API (/v1/rides with a real API key).
 *
 *   Hi -> buy -> pay -> activated -> book -> assign -> complete -> balance 59
 *   -> history -> PAYG paid -> PAYG capacity limit -> app balance + booking.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<{ to: string; text: string }> = [];
const inits: Array<{ reference: string; amountKobo: number; metadata: Record<string, unknown> }> = [];

vi.mock('../../src/services/paystack.js', async (orig) => ({
    ...(await orig<object>()),
    initializeTransaction: vi.fn(async (a: { reference: string; amountKobo: number; metadata: Record<string, unknown> }) => {
        inits.push({ reference: a.reference, amountKobo: a.amountKobo, metadata: a.metadata });
        return { reference: a.reference, authorizationUrl: `https://paystack.test/${inits.length}`, accessCode: 'x' };
    }),
}));
vi.mock('../../src/services/channel-send.js', async (orig) => ({
    ...(await orig<object>()),
    sendChannelText: vi.fn(async (a: { recipientId: string; text: string }) => { sent.push({ to: a.recipientId, text: a.text }); return { messageId: `wamid.out.${sent.length}` }; }),
}));
vi.mock('../../src/services/tenant-channel-creds.js', () => ({
    tenantChannelCreds: () => ({ accessToken: 'test-token', phoneNumberId: 'ph-test' }),
}));
vi.mock('../../src/services/arkesel.js', async (orig) => ({ ...(await orig<object>()), sendSms: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../src/services/gmail-smtp.js', async (orig) => ({ ...(await orig<object>()), sendEmail: vi.fn(async () => ({ ok: true })) }));

import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedConversation, seedTenant, seedUser } from './helpers/seed.js';
import { silentLogger } from './helpers/fake-fastify.js';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import ridesRoutes from '../../src/routes/rides/index.js';
import v1Routes from '../../src/routes/v1/index.js';
import { handleWithFlow } from '../../src/routes/whatsapp/turn-handlers.js';
import { dispatchFulfillment } from '../../src/services/payment-fulfillers.js';
import { registerFlowPaymentFulfiller } from '../../src/services/flow-payments.js';
import { registerRidesPack, installTurboPack } from '../../src/services/rides/index.js';
import { createApiKey } from '../../src/services/api-keys.js';
import { encrypt } from '../../src/services/crypto.js';

const PHONE = '+233241234567';
const GATE = { latitude: 5.6505, longitude: -0.1873, name: 'Main Gate' };

let tenantId: string;
let app: FastifyInstance;
let ownerToken: string;
let staffToken: string;
let n = 0;

async function buildApp(): Promise<FastifyInstance> {
    const prisma = await guardedPrisma();
    const a = Fastify({ logger: false });
    await a.register(sensible);
    await a.register(errorHandler);
    await a.register(fp(async (f) => { f.decorate('prisma', prisma); }, { name: 'prisma' }));
    await a.register(authPlugin);
    await a.register(ridesRoutes, { prefix: '/rides' });
    await a.register(v1Routes, { prefix: '/v1' });
    await a.ready();
    return a;
}

const fastifyLike = async () => ({ prisma: await guardedPrisma(), log: silentLogger, queues: {} }) as any;

/** One inbound WhatsApp message through the production turn handler. Returns what the customer received. */
async function say(convId: string, input: { text?: string; location?: typeof GATE }, recipient = '233241234567'): Promise<string> {
    const before = sent.length;
    const tenant = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const conversation = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: convId } });
    await rawPrisma().conversation.update({ where: { id: convId }, data: { lastInboundAt: new Date() } });
    await handleWithFlow(await fastifyLike(), tenant, { id: conversation.id, customerId: conversation.customerId }, {
        channel: 'WHATSAPP', recipientId: recipient, text: input.text ?? '', inboundRowId: undefined, providerMessageId: `wamid.in.${++n}`,
        ...(input.location ? { location: input.location } : {}),
    });
    return sent.slice(before).map((m) => m.text).join('\n---\n');
}

/** Paystack's webhook after signature verification: verify (mocked) agrees with what we stamped at initialize. */
async function pay(init: (typeof inits)[number], amountKobo = init.amountKobo) {
    const before = sent.length;
    const result = await dispatchFulfillment({
        prisma: await guardedPrisma(), tenantId, reference: init.reference, metadata: init.metadata, log: silentLogger,
        verify: async () => ({ status: 'success', amountKobo, currency: 'GHS', paidAt: new Date(), reference: init.reference, customerEmail: 'x@y.z', channel: 'mobile_money', metadata: init.metadata } as any),
    });
    return { result, reply: sent.slice(before).map((m) => m.text).join('\n---\n') };
}

const api = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe('TURBO journey on a real database', () => {
    beforeEach(async () => {
        sent.length = 0; inits.length = 0; n = 0;
        registerFlowPaymentFulfiller();
        registerRidesPack(await guardedPrisma());
        const tenant = await seedTenant({
            name: 'TURBO', vertical: 'RIDES', paymentCurrency: 'GHS', monthlyMessageQuotaOverride: 10_000,
            paystackSecretKey: encrypt('sk_test_turbo'), whatsappDisplayNumber: '+233200000000',
        });
        tenantId = tenant.id;
        const install = await installTurboPack(rawPrisma(), { tenantId });
        expect(install).toMatchObject({ settingsCreated: true, flowVersion: 1, flowPublished: true });
        expect((await installTurboPack(rawPrisma(), { tenantId })).flowPublished).toBe(false); // idempotent

        app ??= await buildApp();
        const owner = await seedUser(tenantId, { role: 'OWNER' });
        const staff = await seedUser(tenantId, { role: 'STAFF' });
        ownerToken = app.jwt.sign({ userId: owner.id, tenantId, role: 'OWNER', type: 'access' });
        staffToken = app.jwt.sign({ userId: staff.id, tenantId, role: 'STAFF', type: 'access' });
    });

    it('discover -> buy -> pay -> activate -> book -> assign -> complete -> balance 59 -> history -> PAYG -> capacity -> app', async () => {
        // ---- TURBO sets up places and a driver in the console (owner only)
        expect((await api(staffToken, 'POST', '/rides/drivers', { name: 'X', phone: '0240000000', vehicle: 'V', plate: 'P' })).statusCode).toBe(403);
        for (const d of [{ label: 'Main Gate', latitude: 5.6505, longitude: -0.1873, sort: 1 }, { label: 'Library', latitude: 5.6537, longitude: -0.1861, sort: 2 }]) {
            expect((await api(ownerToken, 'POST', '/rides/destinations', d)).statusCode).toBe(201);
        }
        const driverRes = await api(ownerToken, 'POST', '/rides/drivers', { name: 'Kofi Boateng', phone: '0201234567', vehicle: 'Toyota Vitz (silver)', plate: 'GR 1234-24' });
        expect(driverRes.statusCode).toBe(201);
        const driver = driverRes.json();
        expect(driver).toEqual({ id: expect.any(String), name: 'Kofi Boateng', phone: '+233201234567', vehicle: 'Toyota Vitz (silver)', plate: 'GR 1234-24', active: true });

        // ---- Discover
        const conv = await seedConversation(tenantId, { externalId: '233241234567', customerPhone: PHONE, lastInboundAt: new Date() });
        const hi = await say(conv.id, { text: 'Hi' });
        expect(hi).toMatch(/^Heyya, Turber!!\nWe are currently onboarding our first 50 Founding Members\./);
        expect(hi).toMatch(/• GHS 960\n• That's just GHS 16 per ride\n\n🔥 Only 50 Founding Packages available\.\n\n1\. Get Pioneer Package\n2\. PAYG Ride\n3\. Learn More\n4\. Contact Support$/);

        // ---- Buy
        await say(conv.id, { text: '1' });
        await say(conv.id, { text: 'Ama Mensah' });
        await say(conv.id, { text: 'CU2021/1234' });
        await say(conv.id, { text: 'Central University' });
        const confirm = await say(conv.id, { text: 'ama@example.com' });
        expect(confirm).toBe("You're almost in! 🚗\n\nFounding Package — GHS 960\n\n60 rides\n60 days validity\n0–6 km\n\nProceed to payment?\n\n1. Pay GHS 960\n2. Cancel");
        const customer = await rawPrisma().customer.findFirstOrThrow({ where: { tenantId, phone: PHONE } });
        expect(customer).toMatchObject({ name: 'Ama Mensah', email: 'ama@example.com', attributes: { studentId: 'CU2021/1234', university: 'Central University' } });

        const payMsg = await say(conv.id, { text: '1' });
        expect(payMsg).toMatch(/^💳 Pay GHS 960 here \(Mobile Money or card\):\nhttps:\/\/paystack\.test\/1\n\nYour Founding slot is held for 30 minutes\./);
        expect(inits).toHaveLength(1);
        expect(inits[0]).toMatchObject({ amountKobo: 96000, metadata: { fulfillmentKind: 'ride_package', tenantId, collectionRoute: 'OWN_GATEWAY' } });
        const held = await rawPrisma().ridePass.findFirstOrThrow({ where: { tenantId, customerId: customer.id } });
        expect(held).toMatchObject({ id: inits[0].metadata.entityId, status: 'HELD', paymentReference: inits[0].reference, priceMinor: 96000 });

        // Clicking Pay activated nothing.
        expect(await say(conv.id, { text: 'paid?' })).toMatch(/^⏳ We're waiting for your payment to be confirmed/);
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('HELD');

        // ---- Pay (verified webhook) -> activated
        const paid = await pay(inits[0]);
        expect(paid.result.body).toEqual({ ok: true, entity: 'ride_package' });
        expect(paid.reply).toBe("🎉 WELCOME TO TURBO, AMA MENSAH!\n\nYou're officially one of our Founding 50.\n\n🎟️ Your Package\n\n60 rides\nValid for 60 days\n0–6 km\n\nBalance: 60 rides\n\nYou now have priority access to TURBO rides.\n\nWhat would you like to do?\n\n1. Book a Ride\n2. PAYG Ride\n3. Check Balance\n4. Ride History\n5. My Account\n6. Support");
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('ACTIVE');
        // Redelivered webhook: nothing new.
        const again = await pay(inits[0]);
        expect(again.result.body).toEqual({ ok: true, idempotent: true });
        expect(again.reply).toBe('');
        expect(await rawPrisma().ridePassEntry.count({ where: { passId: held.id } })).toBe(1);
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'ride_pass.activated' } })).toBe(1);

        // ---- Book
        expect(await say(conv.id, { text: '1' })).toBe('📍 Where should we pick you up?\n\nPlease share your WhatsApp location.');
        expect(await say(conv.id, { location: GATE })).toBe("📍 Pickup received.\n\nWhere are you going?\n\nReply with a number:\n1. Main Gate\n2. Library\n\nOr share the destination's location pin.");
        expect(await say(conv.id, { text: '2' })).toBe('🚗 Your TURBO Ride\n\nPickup: Main Gate\nDestination: Library\n\nPackage ride: 1 ride\n\nYour current balance: 60\n\nConfirm?\n\n1. Confirm Ride\n2. Cancel');
        expect(await say(conv.id, { text: '1' })).toBe("✅ Ride Request Received\n\nWe're finding your TURBO driver.\n\nPlease stay available.");
        const ride = await rawPrisma().ride.findFirstOrThrow({ where: { tenantId, customerId: customer.id } });
        expect(ride).toMatchObject({ kind: 'PACKAGE', status: 'REQUESTED', passId: held.id, destinationLabel: 'Library', fareMinor: 0 });
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'ride.requested' } })).toBe(1);

        // ---- Console: live, assign (customer told), en route, complete (deducts once), second complete 409
        const live = await api(staffToken, 'GET', '/rides/live');
        expect(live.statusCode).toBe(200);
        expect(live.json().data).toEqual([expect.objectContaining({
            id: ride.id, ref: ride.ref, kind: 'PACKAGE', status: 'REQUESTED', fare: null, driver: null,
            pickup: { label: 'Main Gate', lat: 5.6505, lng: -0.1873 }, destination: { label: 'Library', lat: 5.6537, lng: -0.1861 },
            customer: { id: customer.id, name: 'Ama Mensah', phone: expect.not.stringMatching(/^\+233241234567$/) },
        })]);
        let before = sent.length;
        const assigned = await api(staffToken, 'POST', `/rides/${ride.id}/assign`, { driverId: driver.id });
        expect(assigned.statusCode).toBe(200);
        expect(assigned.json()).toMatchObject({ status: 'ASSIGNED', driver: { id: driver.id, name: 'Kofi Boateng', vehicle: 'Toyota Vitz (silver)', plate: 'GR 1234-24' } });
        expect(sent.slice(before).map((m) => m.text)).toEqual(['🚗 Driver Assigned\n\nDriver: Kofi Boateng\nVehicle: Toyota Vitz (silver)\nPlate: GR 1234-24\n\nYour driver is on the way.']);
        expect((await api(staffToken, 'POST', `/rides/${ride.id}/status`, { status: 'EN_ROUTE' })).json().status).toBe('EN_ROUTE');
        before = sent.length;
        const done = await api(staffToken, 'POST', `/rides/${ride.id}/status`, { status: 'COMPLETED' });
        expect(done.statusCode).toBe(200);
        expect(done.json()).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(String) });
        expect(sent.slice(before).map((m) => m.text)).toEqual(['✅ Ride Completed\n\nThanks for riding with TURBO.\n\n1 ride used\n\n🎟️ Remaining balance: 59 rides\n\nNeed another ride?\nReply BOOK.']);
        expect((await api(staffToken, 'POST', `/rides/${ride.id}/status`, { status: 'COMPLETED' })).statusCode).toBe(409);
        expect(await rawPrisma().ridePassEntry.count({ where: { passId: held.id, type: 'RIDE' } })).toBe(1);

        // ---- Balance 59 and history, in WhatsApp
        await say(conv.id, { text: 'Hi' });
        expect(await say(conv.id, { text: '3' })).toMatch(/^🎟️ Your TURBO Package\n\nPioneer 50\nRides purchased: 60\nRides used: 1\nRides remaining: 59\n\nExpiry: /);
        expect(await say(conv.id, { text: '4' })).toMatch(/^🧾 Your recent rides\n\n1\. .+ · Main Gate → Library · Package · completed/);

        // "Reply BOOK" after the ride: straight into booking.
        await say(conv.id, { text: 'Hi' });
        expect(await say(conv.id, { text: 'BOOK' })).toBe('📍 Where should we pick you up?\n\nPlease share your WhatsApp location.');

        // ---- PAYG with a capacity of 1
        const s = await api(ownerToken, 'PATCH', '/rides/settings', { payg: { dailyLimit: 1 } });
        expect(s.statusCode).toBe(200);
        expect(s.json().payg).toEqual({ open: true, dailyLimit: 1, fares: [{ upToKm: 6, amount: '25.00' }, { upToKm: 10, amount: '35.00' }] });
        expect((await api(staffToken, 'PATCH', '/rides/settings', { payg: { open: false } })).statusCode).toBe(403);

        await say(conv.id, { text: 'menu' });
        expect(await say(conv.id, { text: '2' })).toBe('🚗 PAY-AS-YOU-GO\n\nFare: GHS 25\n\nEnter your pickup location.\n\nShare your WhatsApp location.');
        await say(conv.id, { location: GATE });
        expect(await say(conv.id, { text: 'library' })).toBe('Your ride is GHS 25.\n\n1. Pay & Book\n2. Cancel');
        expect(await say(conv.id, { text: '1' })).toMatch(/^💳 Pay GHS 25 here/);
        expect(inits[1]).toMatchObject({ amountKobo: 2500, metadata: { fulfillmentKind: 'ride_payg' } });
        const pending = await rawPrisma().ride.findUniqueOrThrow({ where: { id: inits[1].metadata.entityId as string } });
        expect(pending).toMatchObject({ kind: 'PAYG', status: 'PENDING_PAYMENT', fareMinor: 2500 });
        const paygPaid = await pay(inits[1]);
        expect(paygPaid.result.body).toEqual({ ok: true, entity: 'ride_payg' });
        expect(paygPaid.reply).toBe("✅ Payment Received\n\nYour ride is confirmed.\n\nWe're assigning your driver now.");
        expect((await rawPrisma().ride.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('REQUESTED');

        // The day's one PAYG seat is taken: a second customer is told so.
        const conv2 = await seedConversation(tenantId, { externalId: '233209999999', customerPhone: '+233209999999', lastInboundAt: new Date() });
        expect(await say(conv2.id, { text: 'Hi' }, '233209999999')).toMatch(/\n2\. PAYG Ride\n/);
        expect(await say(conv2.id, { text: '2' }, '233209999999')).toMatch(/^🔴 PAYG is currently unavailable\n\nToday's available PAYG slots have been filled\.\n\nPioneer Members receive priority access\.\n\nPlease try again later\./);

        // ---- Console overview, customer detail, payments, masking
        const ov = (await api(ownerToken, 'GET', '/rides/overview')).json();
        expect(ov).toMatchObject({
            packages: { sold: 1, activated: 1, cap: 50, slotsLeft: 49, held: 0 },
            rides: { used: 1, remaining: 59 },
            live: { REQUESTED: 1, ASSIGNED: 0, EN_ROUTE: 0 },
            payg: { open: true, dailyLimit: 1, used: 1, available: 0 },
            payments: { SUCCEEDED: 2, PENDING: 0, FAILED: 0 },
            ridesToday: { PACKAGE: 1, PAYG: 1 },
        });
        const detail = (await api(ownerToken, 'GET', `/rides/customers/${customer.id}`)).json();
        expect(detail).toMatchObject({
            id: customer.id, name: 'Ama Mensah', phone: PHONE, studentId: 'CU2021/1234', university: 'Central University',
            package: { id: held.id, name: 'Pioneer 50', status: 'ACTIVE' }, balance: 59,
        });
        expect(detail.balanceLog.map((e: any) => [e.reason, e.delta, e.balanceAfter])).toEqual([['RIDE', -1, 59], ['ACTIVATION', 60, 60]]);
        expect(detail.rides).toHaveLength(2);
        const staffList = (await api(staffToken, 'GET', '/rides/customers?search=Ama')).json();
        expect(staffList.data[0].phone).not.toBe(PHONE);
        const payments = (await api(ownerToken, 'GET', '/rides/payments?status=SUCCEEDED')).json();
        expect(payments.data.map((p: any) => [p.kind, p.amount, p.reference])).toEqual([['PAYG', '25.00', inits[1].reference], ['PACKAGE', '960.00', inits[0].reference]]);
        expect(payments.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });

        // ---- The app sees the same account and balance (v1, API key)
        const { key } = await createApiKey(await guardedPrisma(), { tenantId, name: 'TURBO app', scopes: ['rides:read', 'rides:write'], createdBy: 'test' });
        const v1 = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload ? { payload } : {}) });
        const bal = await v1('GET', `/v1/rides/customers/${customer.id}/balance`);
        expect(bal.statusCode).toBe(200);
        expect(bal.json().data).toMatchObject({ customerId: customer.id, active: true, purchased: 60, used: 1, remaining: 59 });
        expect((await v1('GET', `/v1/rides/customers/${customer.id}/rides`)).json().data).toHaveLength(2);
        // Booking from the app: the PAYG ride is still open, so it is refused like in WhatsApp...
        const lib = await rawPrisma().rideDestination.findFirstOrThrow({ where: { tenantId, label: 'Library' } });
        const refused = await v1('POST', '/v1/rides', { customerId: customer.id, pickup: { label: 'Main Gate', lat: 5.6505, lng: -0.1873 }, destinationId: lib.id });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().error.code).toBe('open_ride');
        // ...until it is done.
        await api(staffToken, 'POST', `/rides/${pending.id}/assign`, { driverId: driver.id });
        await api(staffToken, 'POST', `/rides/${pending.id}/status`, { status: 'COMPLETED' });
        const booked = await v1('POST', '/v1/rides', { customerId: customer.id, pickup: { label: 'Main Gate', lat: 5.6505, lng: -0.1873 }, destinationId: lib.id });
        expect(booked.statusCode).toBe(201);
        expect(booked.json().data).toMatchObject({ kind: 'PACKAGE', status: 'REQUESTED', source: 'APP', destination: { label: 'Library' } });
        const retry = await v1('POST', '/v1/rides', { customerId: customer.id, pickup: { label: 'Main Gate', lat: 5.6505, lng: -0.1873 }, destinationId: lib.id });
        expect(retry.statusCode).toBe(200);
        expect(retry.json().data.id).toBe(booked.json().data.id);
        const readOnly = await createApiKey(await guardedPrisma(), { tenantId, name: 'ro', scopes: ['customers:read'], createdBy: 'test' });
        expect((await app.inject({ method: 'GET', url: `/v1/rides/customers/${customer.id}/balance`, headers: { authorization: `Bearer ${readOnly.key}` } })).statusCode).toBe(403);
    });
});
