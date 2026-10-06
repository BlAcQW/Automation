/**
 * TURBO hand-off and hand-back on a real database, through the real WhatsApp
 * webhook entry point (processWebhook: tenant lookup, conversation resolver,
 * inbound store, HUMAN_ACTIVE check, flow seam) and the real staff routes
 * (/conversations with the real auth plugin):
 *
 *  1. the flow hands off (Contact Support, or the engine's miss limit)
 *     -> HUMAN_ACTIVE and listed in /conversations/pending;
 *  2. while HUMAN_ACTIVE the flow answers nothing (no double replies);
 *  3. after POST /conversations/:id/resume-bot the next message is answered
 *     by the flow from a sane place (the menu), never stuck in 'handed_off'
 *     or in the middle of a question a person already dealt with.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<{ to: string; text: string }> = [];

vi.mock('../../src/services/channel-send.js', async (orig) => ({
    ...(await orig<object>()),
    sendChannelText: vi.fn(async (a: { recipientId: string; text: string }) => { sent.push({ to: a.recipientId, text: a.text }); return { messageId: `wamid.out.${sent.length}` }; }),
}));
vi.mock('../../src/services/tenant-channel-creds.js', () => ({
    tenantChannelCreds: () => ({ accessToken: 'test-token', phoneNumberId: 'ph-test' }),
}));
vi.mock('../../src/services/whatsapp-presence.js', () => ({ markReadAndTyping: vi.fn() }));
vi.mock('../../src/services/paystack.js', async (orig) => ({
    ...(await orig<object>()),
    initializeTransaction: vi.fn(async (a: { reference: string }) => ({ reference: a.reference, authorizationUrl: 'https://paystack.test/1', accessCode: 'x' })),
}));
vi.mock('../../src/services/arkesel.js', async (orig) => ({ ...(await orig<object>()), sendSms: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../src/services/gmail-smtp.js', async (orig) => ({ ...(await orig<object>()), sendEmail: vi.fn(async () => ({ ok: true })) }));

import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedTenant, seedUser } from './helpers/seed.js';
import { silentLogger } from './helpers/fake-fastify.js';
import errorHandler from '../../src/plugins/error-handler.js';
import authPlugin from '../../src/plugins/auth.js';
import conversationsRoutes from '../../src/routes/conversations/index.js';
import { processWebhook } from '../../src/routes/whatsapp/index.js';
import { registerFlowPaymentFulfiller } from '../../src/services/flow-payments.js';
import { registerRidesPack, installTurboPack } from '../../src/services/rides/index.js';
import { encrypt } from '../../src/services/crypto.js';

const WA_ID = '233241234567';
const PHONE_NUMBER_ID = 'ph-turbo-handoff';

let tenantId: string;
let app: FastifyInstance;
let staffToken: string;
let n = 0;

async function buildApp(): Promise<FastifyInstance> {
    const prisma = await guardedPrisma();
    const a = Fastify({ logger: false });
    await a.register(sensible);
    await a.register(errorHandler);
    await a.register(fp(async (f) => { f.decorate('prisma', prisma); }, { name: 'prisma' }));
    await a.register(authPlugin);
    await a.register(conversationsRoutes, { prefix: '/conversations' });
    await a.ready();
    return a;
}

const api = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${staffToken}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

/** One inbound WhatsApp text through the production webhook entry point. Returns what the customer received. */
async function say(text: string): Promise<string> {
    const before = sent.length;
    const fastify = { prisma: await guardedPrisma(), log: silentLogger, redis: null, queues: {} };
    await processWebhook(fastify, {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: PHONE_NUMBER_ID, display_phone_number: '233200000000' },
            contacts: [{ profile: { name: 'Ama' }, wa_id: WA_ID }],
            messages: [{ from: WA_ID, id: `wamid.in.${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
        } }] }],
    } as any);
    return sent.slice(before).map((m) => m.text).join('\n---\n');
}

const conversation = () => rawPrisma().conversation.findFirstOrThrow({ where: { tenantId, externalId: WA_ID } });
const flowState = async () => ((await conversation()).botContext as { flow?: { status: string; current: string; misses: number } } | null)?.flow;
const supportOption = (menu: string) => menu.match(/(\d+)\. Contact Support/)?.[1] ?? '';

describe('TURBO hand-off and hand-back on a real database', () => {
    beforeEach(async () => {
        sent.length = 0; n = 0;
        registerFlowPaymentFulfiller();
        registerRidesPack(await guardedPrisma());
        const tenant = await seedTenant({
            name: 'TURBO', vertical: 'RIDES', paymentCurrency: 'GHS', monthlyMessageQuotaOverride: 10_000,
            paystackSecretKey: encrypt('sk_test_turbo'), whatsappDisplayNumber: '+233200000000',
            whatsappPhoneNumberId: PHONE_NUMBER_ID,
        });
        tenantId = tenant.id;
        expect(await installTurboPack(rawPrisma(), { tenantId })).toMatchObject({ flowPublished: true });
        app ??= await buildApp();
        const staff = await seedUser(tenantId, { role: 'STAFF' });
        staffToken = app.jwt.sign({ userId: staff.id, tenantId, role: 'STAFF', type: 'access' });
    });

    it('Contact Support -> pending for a person; silent while a person has it; resume -> the menu again', async () => {
        const menu = await say('Hi');
        expect(menu).toMatch(/^Heyya, Turber!!/);
        expect(supportOption(menu)).not.toBe('');

        // (1) the flow hands off
        expect(await say(supportOption(menu))).toBe('👋 Connecting you with the TURBO team. Someone will reply here shortly.');
        const handed = await conversation();
        expect(handed).toMatchObject({ state: 'HUMAN_ACTIVE', assignedUserId: null, takeoverAt: expect.any(Date) });
        expect((await flowState())?.status).toBe('handed_off');

        const pending = await api('GET', '/conversations/pending');
        expect(pending.statusCode).toBe(200);
        expect(pending.json()).toMatchObject({ count: 1, data: [expect.objectContaining({ id: handed.id })] });
        const humanList = await api('GET', '/conversations?state=HUMAN_ACTIVE');
        expect(humanList.json().data).toEqual([expect.objectContaining({ id: handed.id, state: 'HUMAN_ACTIVE', lastMessageDirection: 'OUTBOUND' })]);

        // (2) a person has it: the flow says nothing, the message is still stored
        expect(await say('Hello? My driver did not come')).toBe('');
        expect(await say('1')).toBe('');
        const inbound = await rawPrisma().message.findMany({ where: { conversationId: handed.id, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' } });
        expect(inbound.map((m) => m.content).slice(-2)).toEqual(['Hello? My driver did not come', '1']);
        expect(inbound.every((m) => m.handledAt !== null)).toBe(true);
        expect((await api('GET', '/conversations?state=HUMAN_ACTIVE')).json().data[0]).toMatchObject({ lastMessageDirection: 'INBOUND', lastMessage: '1' });

        // (3) staff hands it back; the next message gets the menu, not silence or a stale step
        const resumed = await api('POST', `/conversations/${handed.id}/resume-bot`);
        expect(resumed.statusCode).toBe(200);
        expect((await api('GET', '/conversations/pending')).json().count).toBe(0);
        expect(await say('thanks')).toMatch(/^Heyya, Turber!![\s\S]*Contact Support$/);
        expect(await flowState()).toMatchObject({ status: 'active', misses: 0 });
    });

    it('the miss limit hands off, and after resume the counter starts again (no instant re-handoff)', async () => {
        await say('Hi');
        expect(await say('what')).toMatch(/^Sorry, I didn't get that/);
        expect(await say('huh')).toMatch(/^Sorry, I didn't get that/);
        expect(await say('???')).toBe("I'm having trouble understanding. Someone from the TURBO team will reply shortly.");
        const handed = await conversation();
        expect(handed.state).toBe('HUMAN_ACTIVE');
        expect((await api('GET', '/conversations/pending')).json().data.map((c: { id: string }) => c.id)).toEqual([handed.id]);
        expect(await say('hello')).toBe('');

        expect((await api('POST', `/conversations/${handed.id}/resume-bot`)).statusCode).toBe(200);
        expect(await say('ok')).toMatch(/^Heyya, Turber!!/);
        // One unclear message after the hand-back is a re-prompt, not straight back to a person.
        expect(await say('hmm')).toMatch(/^Sorry, I didn't get that/);
        expect((await conversation()).state).toBe('BOT_ACTIVE');
    });

    it('staff take over in the middle of a question; after resume the customer gets the menu, not the old question', async () => {
        await say('Hi');
        expect(await say('1')).toBe("Let's get you in! 🚗\n\nWhat's your full name?");
        const conv = await conversation();

        expect((await api('POST', `/conversations/${conv.id}/activate-human`)).statusCode).toBe(200);
        expect(await say('Can I pay cash instead?')).toBe('');

        expect((await api('POST', `/conversations/${conv.id}/resume-bot`)).statusCode).toBe(200);
        // "Thanks" must not be taken as the customer's full name hours later.
        expect(await say('Thanks')).toMatch(/^Heyya, Turber!!/);
        expect(await rawPrisma().customer.count({ where: { tenantId, name: 'Thanks' } })).toBe(0);
        expect((await flowState())?.current).not.toBe('reg_student');
    });

    it('a flow waiting on a payment keeps waiting after a hand-back (a late payment still finds its step)', async () => {
        await say('Hi');
        await say('1');
        await say('Ama Mensah');
        await say('CU2021/1234');
        await say('Central University');
        await say('ama@example.com');
        expect(await say('1')).toMatch(/^💳 Pay GHS/);
        expect(await flowState()).toMatchObject({ status: 'waiting' });

        const conv = await conversation();
        expect((await api('POST', `/conversations/${conv.id}/activate-human`)).statusCode).toBe(200);
        expect((await api('POST', `/conversations/${conv.id}/resume-bot`)).statusCode).toBe(200);
        const after = await flowState();
        expect(after).toMatchObject({ status: 'waiting', misses: 0 });
        expect(await say('paid?')).toMatch(/^⏳ We're waiting for your payment to be confirmed/);
    });
});
