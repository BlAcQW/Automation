/**
 * A Payaza-paid Founding Package on a real database, through the real seams:
 *   WhatsApp turn (handleWithFlow) -> flow -> ride_package preparer -> Payaza
 *   payment page (built, no network) -> signed POST /payments/payaza/webhook
 *   (real route, real signature check, Payaza status query mocked) ->
 *   ride_package fulfiller -> pass ACTIVE, provider recorded -> console list.
 * Also: a tenant that chose Payaza but has no keys gets no link at all.
 */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<{ to: string; text: string }> = [];
const queried: Array<{ publicKey: string; mode: string; reference: string }> = [];
let queryAmountMinor = 96000;

vi.mock('../../src/services/paystack.js', async (orig) => ({
    ...(await orig<object>()),
    initializeTransaction: vi.fn(async () => { throw new Error('Paystack must not be called for a Payaza tenant'); }),
}));
vi.mock('../../src/services/payaza.js', async (orig) => ({
    ...(await orig<object>()),
    queryTransaction: vi.fn(async (publicKey: string, mode: string, reference: string) => {
        queried.push({ publicKey, mode, reference });
        return {
            status: 'success', amountKobo: queryAmountMinor, currency: 'GHS', paidAt: new Date(), reference,
            customerEmail: '', channel: 'GH_MOBILEMONEY', transactionId: 'PZ-TX-777', metadata: null,
        };
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
import { seedConversation, seedTenant } from './helpers/seed.js';
import { silentLogger } from './helpers/fake-fastify.js';
import errorHandler from '../../src/plugins/error-handler.js';
import paymentsRoutes from '../../src/routes/payments/index.js';
import { handleWithFlow } from '../../src/routes/whatsapp/turn-handlers.js';
import { registerFlowPaymentFulfiller } from '../../src/services/flow-payments.js';
import { registerRidesPack, installTurboPack } from '../../src/services/rides/index.js';
import { paymentList } from '../../src/services/rides/console.js';
import { tenantContext } from '../../src/lib/tenant-context.js';
import { encrypt } from '../../src/services/crypto.js';

const PHONE = '+233241234567';
const PUB = 'PZ78-PKTEST-DB-SUITE-PUBLIC';
const SEC = 'PZ78-SKTEST-DB-SUITE-SECRET';
const PAYAZA_LINK = /https:\/\/payment\.payaza\.africa\/\?\S+/;

let tenantId: string;
let app: FastifyInstance;
let n = 0;

async function buildApp(): Promise<FastifyInstance> {
    const prisma = await guardedPrisma();
    const a = Fastify({ logger: false });
    await a.register(sensible);
    await a.register(errorHandler);
    await a.register(fp(async (f) => { f.decorate('prisma', prisma); }, { name: 'prisma' }));
    a.decorate('authenticate', async () => {});
    a.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        (req as any).rawBody = body;
        done(null, JSON.parse((body as Buffer).toString('utf8')));
    });
    await a.register(paymentsRoutes, { prefix: '/payments' });
    await a.ready();
    return a;
}

const fastifyLike = async () => ({ prisma: await guardedPrisma(), log: silentLogger, queues: {} }) as any;

async function say(convId: string, text: string): Promise<string> {
    const before = sent.length;
    const tenant = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const conversation = await rawPrisma().conversation.findUniqueOrThrow({ where: { id: convId } });
    await rawPrisma().conversation.update({ where: { id: convId }, data: { lastInboundAt: new Date() } });
    await handleWithFlow(await fastifyLike(), tenant, { id: conversation.id, customerId: conversation.customerId }, {
        channel: 'WHATSAPP', recipientId: '233241234567', text, inboundRowId: undefined, providerMessageId: `wamid.in.${++n}`,
    });
    return sent.slice(before).map((m) => m.text).join('\n---\n');
}

async function buyUpToPay(convId: string): Promise<string> {
    for (const text of ['Hi', '1', 'Ama Mensah', 'CU2021/1234', 'Central University', 'ama@example.com']) await say(convId, text);
    return say(convId, '1');
}

function linkIn(message: string): URL {
    const found = message.match(PAYAZA_LINK);
    if (!found) throw new Error(`no Payaza link in: ${message}`);
    return new URL(found[0]);
}

async function deliver(payload: Record<string, unknown>, key = SEC) {
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha512', key).update(raw).digest('base64');
    return app.inject({ method: 'POST', url: '/payments/payaza/webhook', headers: { 'content-type': 'application/json', 'x-payaza-signature': signature }, payload: raw });
}

async function seedTurbo(over: Record<string, unknown>) {
    const tenant = await seedTenant({
        name: 'TURBO', vertical: 'RIDES', paymentCurrency: 'GHS', monthlyMessageQuotaOverride: 10_000,
        whatsappDisplayNumber: '+233200000000', ...over,
    });
    tenantId = tenant.id;
    await installTurboPack(rawPrisma(), { tenantId });
    return seedConversation(tenantId, { externalId: '233241234567', customerPhone: PHONE, lastInboundAt: new Date() });
}

const PAYAZA_TENANT = () => ({ paymentProvider: 'PAYAZA', payazaPublicKey: encrypt(PUB), payazaSecretKey: encrypt(SEC), payazaMode: 'TEST' });

describe('Payaza on a real database', () => {
    beforeEach(async () => {
        sent.length = 0; queried.length = 0; n = 0; queryAmountMinor = 96000;
        registerFlowPaymentFulfiller();
        registerRidesPack(await guardedPrisma());
        app ??= await buildApp();
    });

    it('Founding Package paid through Payaza: page link, signed webhook, status query, pass ACTIVE with provider PAYAZA, idempotent', async () => {
        const conv = await seedTurbo(PAYAZA_TENANT());

        const params = linkIn(await buyUpToPay(conv.id)).searchParams;
        expect(params.get('merchant_key')).toBe(PUB);
        expect(params.get('connection_mode')).toBe('Test');
        expect(params.get('checkout_amount')).toBe('960.00');
        expect(params.get('phone_number')).toBe('233241234567');
        expect(params.get('redirect_url')).toBe('https://wa.me/233200000000');
        const reference = params.get('transaction_reference')!;

        const held = await rawPrisma().ridePass.findFirstOrThrow({ where: { tenantId } });
        expect(held).toMatchObject({ status: 'HELD', paymentReference: reference, paymentProvider: null });
        expect(reference.startsWith(`bf_f_ride_package_${held.id}_`)).toBe(true);

        // A notification signed with another key changes nothing.
        expect((await deliver({ merchant_reference: reference, status: 'Completed' }, 'wrong-secret')).statusCode).toBe(401);
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('HELD');

        const before = sent.length;
        const res = await deliver({ transaction_reference: 'PZ-TX-777', merchant_reference: reference, status: 'Completed', amount_received: 960, currency_code: 'GHS', amount_validation: 'EXACT' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, entity: 'ride_package' });
        expect(queried).toEqual([{ publicKey: PUB, mode: 'TEST', reference }]);
        expect(sent.slice(before).map((m) => m.text).join('\n')).toMatch(/WELCOME TO TURBO, AMA MENSAH/);

        const paid = await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: held.id } });
        expect(paid).toMatchObject({ status: 'ACTIVE', paidAmountMinor: 96000, paymentProvider: 'PAYAZA', providerTransactionId: 'PZ-TX-777', paymentChannel: 'GH_MOBILEMONEY' });

        // Redelivery: nothing new.
        const again = await deliver({ transaction_reference: 'PZ-TX-777', merchant_reference: reference, status: 'Completed' });
        expect(again.json()).toEqual({ ok: true, idempotent: true });
        expect(await rawPrisma().ridePassEntry.count({ where: { passId: held.id } })).toBe(1);
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'ride_pass.activated' } })).toBe(1);

        // The console's payment list says which gateway took it.
        const prisma = await guardedPrisma();
        const list = await tenantContext.run({ tenantId, userId: 'u1' }, () => paymentList(prisma, tenantId, { page: 1, limit: 20 }, false));
        expect(list.data).toEqual([expect.objectContaining({ passId: held.id, status: 'SUCCEEDED', provider: 'PAYAZA', providerReference: 'PZ-TX-777' })]);
    });

    it('an underpaid Payaza charge activates nothing and is reported for a Payaza refund', async () => {
        const conv = await seedTurbo(PAYAZA_TENANT());
        const reference = linkIn(await buyUpToPay(conv.id)).searchParams.get('transaction_reference')!;

        queryAmountMinor = 100; // the customer edited the amount on the page
        const res = await deliver({ merchant_reference: reference, status: 'Completed', amount_received: 1, amount_validation: 'UNDERPAYMENT' });
        expect(res.statusCode).toBe(200);
        const pass = await rawPrisma().ridePass.findFirstOrThrow({ where: { tenantId } });
        expect(pass.status).not.toBe('ACTIVE');
        const alert = await rawPrisma().platformAlert.findFirst({ where: { tenantId, kind: 'ride_package.not_applied' } });
        expect(alert?.message).toMatch(/Refund it from your Payaza dashboard\./);
        expect(await rawPrisma().auditLog.count({ where: { tenantId, action: 'payment.unattributed' } })).toBe(1);
    });

    it('PAYAZA chosen without keys: no link, Paystack never called, the held slot is released', async () => {
        const conv = await seedTurbo({ paymentProvider: 'PAYAZA', paystackSecretKey: encrypt('sk_test_turbo') });
        const payMsg = await buyUpToPay(conv.id);
        expect(payMsg).not.toMatch(/payaza\.africa|paystack/);
        expect(await rawPrisma().ridePass.count({ where: { tenantId, status: 'HELD' } })).toBe(0);
    });
});
