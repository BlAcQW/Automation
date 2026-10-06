/**
 * Wave 2 wiring through the real webhook entry point, on BOTH inbound paths
 * (WhatsApp and Instagram/Messenger): the seam picks the engine per tenant, flow
 * turns answer through the reply outbox, external-app tenants get
 * `message.received` and no bot reply, and every inbound message is announced
 * and linked to its customer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveConversation = vi.fn();
vi.mock('../../services/conversation-resolver.js', () => ({ resolveConversation: (...a: unknown[]) => resolveConversation(...a) }));
const runAgent = vi.fn();
let llmEnabled = true;
vi.mock('../../services/llm-agent.js', () => ({ runAgent: (...a: unknown[]) => runAgent(...a), isLlmEnabled: () => llmEnabled }));
const sendChannelText = vi.fn();
vi.mock('../../services/channel-send.js', async (orig) => ({
    ...(await orig<typeof import('../../services/channel-send.js')>()),
    sendChannelText: (...a: unknown[]) => sendChannelText(...a),
}));
const tryReserveOutbound = vi.fn();
const checkOutboundQuota = vi.fn();
vi.mock('../../services/usage.js', () => ({
    checkOutboundQuota: (...a: unknown[]) => checkOutboundQuota(...a),
    tryReserveOutbound: (...a: unknown[]) => tryReserveOutbound(...a),
    rollbackOutboundReservation: vi.fn(async () => undefined),
}));
vi.mock('../../services/crypto.js', async (orig) => ({ ...(await orig<any>()), decrypt: (v: string) => `dec:${v}` }));
const raiseAlert = vi.fn();
vi.mock('../../services/alerts.js', () => ({ raiseAlert: (...a: unknown[]) => raiseAlert(...a) }));
vi.mock('../../services/whatsapp-presence.js', () => ({ markReadAndTyping: vi.fn() }));
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
const createFulfillmentPaymentLink = vi.fn();
vi.mock('../../services/payment-link.js', () => ({
    createFulfillmentPaymentLink: (...a: unknown[]) => createFulfillmentPaymentLink(...a),
    createPaymentLink: vi.fn(),
}));
const resolveCustomerIdSafe = vi.fn();
const linkConversationToCustomer = vi.fn();
vi.mock('../../services/customers.js', () => ({
    resolveCustomerIdSafe: (...a: unknown[]) => resolveCustomerIdSafe(...a),
    linkConversationToCustomer: (...a: unknown[]) => linkConversationToCustomer(...a),
}));

import { publishEvent } from '../../services/events/publish.js';
import { processWebhook } from './index.js';
import { registerFlowPaymentFulfiller } from '../../services/flow-payments.js';
import { resetPaymentFulfillersForTests } from '../../services/payment-fulfillers.js';
import { HOLDING_MESSAGE } from '../../services/assistant-fallback.js';
import { makeFlowKit, MENU_FLOW, PAY_FLOW } from '../../test-utils/flow-kit.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

type Channel = 'WHATSAPP' | 'MESSENGER' | 'INSTAGRAM';

function build(opts: Parameters<typeof makeFlowKit>[0] & { channel?: Channel } = {}) {
    const channel = opts.channel ?? 'WHATSAPP';
    const kit = makeFlowKit({
        ...opts,
        tenant: {
            facebookPageId: 'p1', facebookPageToken: 'enc-page', instagramUserId: 'ig1',
            ...opts.tenant,
        },
        conversation: {
            channel,
            externalId: channel === 'WHATSAPP' ? '233241234567' : 's1',
            customerPhone: channel === 'WHATSAPP' ? '233241234567' : null,
            ...opts.conversation,
        },
    });
    kit.installPublish(publish);
    resolveConversation.mockImplementation(async () => ({
        id: kit.conv.id, state: kit.conv.state, customerName: kit.conv.customerName ?? null, customerPhone: kit.conv.customerPhone,
        customerId: kit.conv.customerId, botContext: kit.conv.botContext, botFailureCount: kit.conv.botFailureCount, created: false,
    }));
    const fastify: any = {
        redis: null,
        queues: {},
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        prisma: kit.prisma,
    };
    const send = (text: string, id = 'msg-1') =>
        processWebhook(fastify, channel === 'WHATSAPP' ? waPayload(text, id) : channelPayload(channel, text, id));
    return { kit, fastify, send, channel };
}

const waPayload = (text: string, id: string): any => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'b', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'ph1', display_phone_number: '1' },
        contacts: [{ profile: { name: 'Ama' }, wa_id: '233241234567' }],
        messages: [{ from: '233241234567', id, timestamp: '1', type: 'text', text: { body: text } }],
    } }] }],
});
const channelPayload = (channel: Channel, text: string, id: string): any => ({
    object: channel === 'INSTAGRAM' ? 'instagram' : 'page',
    entry: [{ id: 'p1', messaging: [{ sender: { id: 's1' }, message: { mid: id, text } }] }],
});

const CHANNELS: Channel[] = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM'];

beforeEach(() => {
    for (const m of [resolveConversation, runAgent, sendChannelText, tryReserveOutbound, checkOutboundQuota, raiseAlert, publish, createFulfillmentPaymentLink, resolveCustomerIdSafe, linkConversationToCustomer]) m.mockReset();
    llmEnabled = true;
    resetPaymentFulfillersForTests();
    registerFlowPaymentFulfiller();
    tryReserveOutbound.mockResolvedValue({ ok: true });
    checkOutboundQuota.mockResolvedValue({ ok: true });
    sendChannelText.mockResolvedValue({ messageId: 'mid.OUT' });
    runAgent.mockResolvedValue({ reply: 'Booked for 3pm', wantsHuman: false, toolsUsed: [] });
    createFulfillmentPaymentLink.mockImplementation(async (a: any) => {
        await a.onCreated({ reference: 'bf_f_ref1', authorizationUrl: 'https://paystack/x', collectionRoute: 'OWN_GATEWAY' });
        return 'https://paystack/x';
    });
    resolveCustomerIdSafe.mockResolvedValue(null);
    linkConversationToCustomer.mockResolvedValue(false);
});

describe.each(CHANNELS)('flow turn (%s)', (channel) => {
    it('RIDES tenants run the flow and the reply goes through the outbox', async () => {
        const { kit, send } = build({ channel });
        await send('hi');

        expect(runAgent).not.toHaveBeenCalled();
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0]).toMatchObject({
            channel, recipientId: channel === 'WHATSAPP' ? '233241234567' : 's1', text: 'Pay here: https://paystack/x',
        });

        const inbound = kit.messages.find((m) => m.direction === 'INBOUND')!;
        expect(inbound.handledAt).toBeInstanceOf(Date);
        expect(kit.outbound()).toHaveLength(1);
        expect(kit.outbound()[0]).toMatchObject({
            sendState: 'SENT', replyToId: inbound.id, content: 'Pay here: https://paystack/x',
            metadata: expect.objectContaining({ source: 'flow' }),
        });

        // The link is for the flow_payment kind, own gateway, tied to this conversation.
        expect(createFulfillmentPaymentLink.mock.calls[0][0]).toMatchObject({ kind: 'flow_payment', tenantId: 't1', amount: 25 });
        expect(createFulfillmentPaymentLink.mock.calls[0][0].entityId).toMatch(/^c1\.pay\.2500\.GHS$/);
        // State persisted for advanceFlow.
        expect(kit.conv.botContext.flow).toMatchObject({ status: 'waiting', current: 'pay', lastInboundId: 'msg-1' });
    });

    it('announces message.received and message.sent (FLOW)', async () => {
        const { kit, send } = build({ channel });
        await send('hi');
        const inbound = kit.messages.find((m) => m.direction === 'INBOUND')!;
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
        expect(kit.eventsOfType('message.received')[0]).toMatchObject({
            tenantId: 't1',
            payload: { v: 1, conversationId: 'c1', messageId: inbound.id, channel, text: 'hi', type: 'TEXT', customerId: null },
        });
        expect(kit.eventsOfType('message.sent')).toHaveLength(1);
        expect(kit.eventsOfType('message.sent')[0]).toMatchObject({
            payload: { v: 1, conversationId: 'c1', messageId: kit.outbound()[0].id, channel, sentBy: 'FLOW' },
        });
    });

    it('announces flow.completed (v1) once, only when a turn takes the flow to its end', async () => {
        const { kit, send } = build({ channel, definition: MENU_FLOW, conversation: { customerId: 'cu1' } });
        await send('hi', 'm-a');
        expect(kit.eventsOfType('flow.completed')).toHaveLength(0);
        await send('2', 'm-b'); // "Done" -> bye (end)
        const done = kit.eventsOfType('flow.completed');
        expect(done).toHaveLength(1);
        expect(done[0]).toMatchObject({
            tenantId: 't1',
            payload: { v: 1, flowKey: 'menu-flow', version: 1, conversationId: 'c1', customerId: 'cu1', vars: {} },
        });
        await send('2', 'm-b'); // redelivery of the same message
        expect(kit.eventsOfType('flow.completed')).toHaveLength(1);
    });

    it('a flow that hands off does not announce flow.completed', async () => {
        const { kit, send } = build({ channel, definition: MENU_FLOW });
        await send('hi', 'm-a');
        await send('1', 'm-b'); // "Talk to staff"
        expect(kit.eventsOfType('flow.completed')).toHaveLength(0);
    });

    it('a redelivery of a handled message does nothing more', async () => {
        const { kit, send } = build({ channel });
        await send('hi');
        await send('hi');
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(createFulfillmentPaymentLink).toHaveBeenCalledTimes(1);
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
    });

    it('a send failure keeps the reply PENDING; the retry re-sends it WITHOUT re-running the flow', async () => {
        const { kit, send } = build({ channel });
        sendChannelText.mockRejectedValueOnce(new Error('graph down'));
        await expect(send('hi')).rejects.toThrow(/webhook item/);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeNull();
        expect(kit.outbound()[0]).toMatchObject({ sendState: 'PENDING' });
        expect(kit.conv.botContext.flow.status).toBe('waiting'); // state was saved

        await send('hi'); // inbox retry
        expect(createFulfillmentPaymentLink).toHaveBeenCalledTimes(1);
        expect(sendChannelText).toHaveBeenCalledTimes(2);
        expect(sendChannelText.mock.calls[1][0].text).toBe('Pay here: https://paystack/x');
        expect(kit.outbound()).toHaveLength(1);
        expect(kit.outbound()[0].sendState).toBe('SENT');
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
        expect(kit.eventsOfType('message.sent')).toHaveLength(1);
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
    });

    it('a flow hand-off takes the conversation to a person once, with no extra holding message', async () => {
        const { kit, send } = build({ channel, definition: MENU_FLOW });
        await send('hi', 'msg-1'); // menu
        expect(sendChannelText.mock.calls[0][0].text).toMatch(/^Welcome/);

        await send('1', 'msg-2'); // "Talk to staff"
        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(kit.conv.takeoverReason).toBe('flow_staff');
        expect(sendChannelText).toHaveBeenCalledTimes(2);
        expect(sendChannelText.mock.calls[1][0].text).toBe('Connecting you to the team.');
        const takeovers = kit.prisma.conversation.update.mock.calls.filter((c: any) => c[0].data.state === 'HUMAN_ACTIVE');
        expect(takeovers).toHaveLength(1);
        expect(kit.eventsOfType('conversation.handoff')).toHaveLength(1);
    });

    it('a missing flow definition hands off with ONE holding message', async () => {
        const { kit, send } = build({ channel, tenant: { activeFlowKey: 'no-such-flow' } });
        await send('hi');
        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0].text).toBe(HOLDING_MESSAGE);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
        expect(kit.eventsOfType('conversation.handoff')).toHaveLength(1);
        // The holding message is announced when it is actually sent.
        expect(kit.eventsOfType('message.sent')).toHaveLength(1);
        expect(kit.eventsOfType('message.sent')[0].payload).toMatchObject({ channel, sentBy: 'AI' });
    });

    it('does nothing for a human-handled conversation (but still announces the message)', async () => {
        const { kit, send } = build({ channel, conversation: { state: 'HUMAN_ACTIVE' } });
        await send('hello?');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
    });

    it('an exhausted quota stops the turn before any side effect, like the agent path', async () => {
        const { kit, send } = build({ channel });
        checkOutboundQuota.mockResolvedValue({ ok: false });
        await send('hi');
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
    });

    it('a reservation refused at send time suppresses the reply without failing the turn', async () => {
        const { kit, send } = build({ channel });
        tryReserveOutbound.mockResolvedValue({ ok: false });
        await send('hi');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(kit.outbound()).toHaveLength(0); // nothing is stored for a reply that was never going to be sent
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
        expect(kit.eventsOfType('message.sent')).toHaveLength(0); // not actually sent
    });
});

describe('conversationMode override reaches the seam', () => {
    it("an APPOINTMENTS tenant with mode 'flow' runs the flow, not the agent", async () => {
        const { send } = build({ tenant: { vertical: 'APPOINTMENTS', conversationMode: 'flow' } });
        await send('hi');
        expect(runAgent).not.toHaveBeenCalled();
        expect(createFulfillmentPaymentLink).toHaveBeenCalled();
    });

    it("a RIDES tenant with mode 'llm' uses the agent", async () => {
        const { send } = build({ tenant: { vertical: 'RIDES', conversationMode: 'llm' } });
        await send('hi');
        expect(runAgent).toHaveBeenCalledTimes(1);
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
    });

    it('an unknown mode hands off with the holding message (fail safe)', async () => {
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS', conversationMode: 'turbo' } });
        await send('hi');
        expect(runAgent).not.toHaveBeenCalled();
        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(sendChannelText.mock.calls[0][0].text).toBe(HOLDING_MESSAGE);
    });

    it('APPOINTMENTS with no override is unchanged: the agent answers via the outbox', async () => {
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS', conversationMode: null } });
        await send('book me');
        expect(runAgent).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0].text).toBe('Booked for 3pm');
        expect(kit.outbound()[0]).toMatchObject({ sendState: 'SENT', metadata: expect.objectContaining({ source: 'llm' }) });
        expect(kit.eventsOfType('message.sent')[0].payload.sentBy).toBe('AI');
    });

    it('APPOINTMENTS without the LLM is unchanged: handoff plus holding message', async () => {
        llmEnabled = false;
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' } });
        await send('hi');
        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(sendChannelText.mock.calls[0][0].text).toBe(HOLDING_MESSAGE);
    });
});

describe.each(CHANNELS)('external app (%s)', (channel) => {
    const app = { id: 'a1', tenantId: 't1', isActive: true };

    it('publishes message.received with the text and sends NO reply', async () => {
        resolveCustomerIdSafe.mockResolvedValue(channel === 'WHATSAPP' ? 'cu1' : null);
        linkConversationToCustomer.mockResolvedValue(true);
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: app });
        await send('I need a ride to campus');

        const inbound = kit.messages.find((m) => m.direction === 'INBOUND')!;
        expect(kit.eventsOfType('message.received')).toEqual([
            expect.objectContaining({
                tenantId: 't1',
                payload: {
                    v: 1, conversationId: 'c1', messageId: inbound.id, channel, text: 'I need a ride to campus', type: 'TEXT',
                    customerId: channel === 'WHATSAPP' ? 'cu1' : null,
                },
            }),
        ]);
        expect(inbound.handledAt).toBeInstanceOf(Date);
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(runAgent).not.toHaveBeenCalled();
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
        expect(kit.outbound()).toHaveLength(0);
        expect(kit.conv.state).toBe('BOT_ACTIVE');
    });

    it('does not run keyword takeover detection: the app sees "speak to human" and decides', async () => {
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: app });
        await send('I want to speak to a real person');
        expect(kit.conv.state).toBe('BOT_ACTIVE');
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
    });

    it('a failed publish fails the turn (inbound stays unhandled) and the retry publishes exactly once', async () => {
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: app });
        publish.mockRejectedValueOnce(new Error('events db down'));
        await expect(send('hi')).rejects.toThrow(/webhook item/);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeNull();

        await send('hi'); // inbox retry
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
    });

    it('a retried turn whose event was already published does not publish again', async () => {
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: app });
        // The first attempt published, then died before marking the inbound handled.
        kit.messages.push({
            id: 'm-seed', conversationId: 'c1', direction: 'INBOUND', whatsappMsgId: 'msg-1', handledAt: null, content: 'hi',
        });
        kit.events.push({ id: 'e0', tenantId: 't1', type: 'message.received', dedupeKey: 'message.received:messageId:m-seed', payload: { v: 1, messageId: 'm-seed' } });
        await send('hi');
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
        expect(kit.messages.find((m) => m.id === 'm-seed')!.handledAt).toBeInstanceOf(Date);
    });

    it('a human-handled conversation still gets the event, never a reply, and the keyword does not resume the bot', async () => {
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: app, conversation: { state: 'HUMAN_ACTIVE' } });
        await send('menu');
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(kit.eventsOfType('conversation.resumed')).toHaveLength(0);
    });

    it.each([
        ['missing', null],
        ['inactive', { id: 'a1', tenantId: 't1', isActive: false }],
    ])('an %s app hands off to a human with the holding message and raises one alert per tenant', async (_l, row) => {
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: row });
        await send('hi');

        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(kit.conv.takeoverReason).toBe('external_app_unavailable');
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0].text).toBe(HOLDING_MESSAGE);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
        expect(kit.eventsOfType('conversation.handoff')).toHaveLength(1);

        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect(raiseAlert.mock.calls[0][1]).toMatchObject({
            kind: 'external_app.unavailable', severity: 'warning', tenantId: 't1', dedupeKey: 'external_app.unavailable:t1',
        });
    });

    it('looks up the app scoped to the tenant', async () => {
        const { kit, send } = build({ channel, tenant: { conversationMode: 'external' }, externalApp: app });
        await send('hi');
        expect(kit.prisma.externalApp.findFirst.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
    });
});

describe('message.received for every tenant', () => {
    it.each(CHANNELS)('an APPOINTMENTS tenant (%s) announces the inbound message too', async (channel) => {
        const { kit, send } = build({ channel, tenant: { vertical: 'APPOINTMENTS' } });
        await send('book me');
        expect(kit.eventsOfType('message.received')).toHaveLength(1);
        expect(kit.eventsOfType('message.received')[0].payload).toMatchObject({ text: 'book me', channel, type: 'TEXT' });
    });

    it('a failing publish never fails the turn', async () => {
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' } });
        publish.mockRejectedValue(new Error('events db down'));
        await send('book me');
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
        expect(kit.outbound()[0].sendState).toBe('SENT');
    });

    it('carries the message type and caption for media on WhatsApp', async () => {
        const { kit, fastify } = build({ tenant: { vertical: 'APPOINTMENTS' } });
        const payload = waPayload('', 'msg-img');
        payload.entry[0].changes[0].value.messages = [
            { from: '233241234567', id: 'msg-img', timestamp: '1', type: 'image', image: { id: 'media1', mime_type: 'image/jpeg', caption: 'my car' } },
        ];
        await processWebhook(fastify, payload);
        expect(kit.eventsOfType('message.received')[0].payload).toMatchObject({ type: 'IMAGE', text: 'my car' });
    });
});

describe('customer linking on inbound', () => {
    it('links a conversation that has a phone and no customer, once', async () => {
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' }, conversation: { customerName: 'Ama' } });
        resolveCustomerIdSafe.mockResolvedValue('cu1');
        linkConversationToCustomer.mockImplementation(async (_p: any, a: any) => { kit.conv.customerId = a.customerId; return true; });

        await send('hi', 'm1');
        await send('again', 'm2');
        await send('and again', 'm3');

        expect(resolveCustomerIdSafe).toHaveBeenCalledTimes(1);
        expect(resolveCustomerIdSafe.mock.calls[0][1]).toMatchObject({ tenantId: 't1', phone: '233241234567', name: 'Ama', businessNumber: '+233 20 000 0000' });
        expect(linkConversationToCustomer).toHaveBeenCalledTimes(1);
        expect(linkConversationToCustomer.mock.calls[0][1]).toEqual({ tenantId: 't1', conversationId: 'c1', customerId: 'cu1' });
        // Every message.received carries the customer once it is known.
        expect(kit.eventsOfType('message.received').map((e) => e.payload.customerId)).toEqual(['cu1', 'cu1', 'cu1']);
    });

    it('does nothing when the conversation is already linked', async () => {
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' }, conversation: { customerId: 'cu9' } });
        await send('hi');
        expect(resolveCustomerIdSafe).not.toHaveBeenCalled();
        expect(linkConversationToCustomer).not.toHaveBeenCalled();
        expect(kit.eventsOfType('message.received')[0].payload.customerId).toBe('cu9');
    });

    it('does nothing on a channel with no phone yet', async () => {
        const { send } = build({ channel: 'MESSENGER', tenant: { vertical: 'APPOINTMENTS' } });
        await send('hi');
        expect(resolveCustomerIdSafe).not.toHaveBeenCalled();
    });

    it('never links on Instagram/Messenger by a typed phone (it could be someone else\'s record)', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cu2');
        linkConversationToCustomer.mockResolvedValue(true);
        const { send } = build({ channel: 'INSTAGRAM', tenant: { vertical: 'APPOINTMENTS' }, conversation: { customerPhone: '+233241234567' } });
        await send('hi');
        expect(linkConversationToCustomer).not.toHaveBeenCalled();
    });

    it('an unlinkable phone leaves the conversation unlinked and the turn running', async () => {
        resolveCustomerIdSafe.mockResolvedValue(null);
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' } });
        await send('hi');
        expect(linkConversationToCustomer).not.toHaveBeenCalled();
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(kit.eventsOfType('message.received')[0].payload.customerId).toBeNull();
    });

    it('a failing link never fails the turn', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cu1');
        linkConversationToCustomer.mockRejectedValue(new Error('db'));
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' } });
        await send('hi');
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
    });
});

describe('conversation.resumed on a keyword resume', () => {
    it('publishes once when a customer takes a conversation back to the assistant', async () => {
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' }, conversation: { state: 'HUMAN_ACTIVE' } });
        await send('menu');
        expect(kit.conv.state).toBe('BOT_ACTIVE');
        expect(kit.eventsOfType('conversation.resumed')).toEqual([
            expect.objectContaining({ tenantId: 't1', payload: { v: 1, conversationId: 'c1' } }),
        ]);
    });

    it('a flow tenant can resume too (a flow counts as an assistant) and the flow restarts', async () => {
        const { kit, send } = build({ conversation: { state: 'HUMAN_ACTIVE' } });
        await send('bot');
        expect(kit.eventsOfType('conversation.resumed')).toHaveLength(1);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(kit.conv.botContext.flow.status).toBe('waiting');
    });

    it('does not publish when the keyword cannot resume (no assistant)', async () => {
        llmEnabled = false;
        const { kit, send } = build({ tenant: { vertical: 'APPOINTMENTS' }, conversation: { state: 'HUMAN_ACTIVE' } });
        await send('menu');
        expect(kit.eventsOfType('conversation.resumed')).toHaveLength(0);
    });
});

/**
 * A support pause is not "quota exhausted". Both are silent for the customer
 * (no reply), but the log must say which, so support is not chasing a quota
 * that is fine and an owner is not told to upgrade.
 */
describe.each(CHANNELS)('outbound pause (%s)', (channel) => {
    const warned = (fastify: any) => fastify.log.warn.mock.calls.map((c: any[]) => String(c[1] ?? c[0]));

    it('flow turn: a paused tenant stops before any side effect and logs "paused", not quota', async () => {
        const { kit, fastify, send } = build({ channel });
        checkOutboundQuota.mockResolvedValue({ ok: false, paused: true, pauseReason: 'abuse' });
        await send('hi');
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(warned(fastify).some((m: string) => /paused/i.test(m))).toBe(true);
        expect(warned(fastify).some((m: string) => /quota/i.test(m))).toBe(false);
        expect(kit.messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
    });

    it('agent turn: a paused tenant never reaches the model and logs "paused", not quota', async () => {
        const { fastify, send } = build({ channel, tenant: { vertical: 'APPOINTMENTS' } });
        checkOutboundQuota.mockResolvedValue({ ok: false, paused: true });
        await send('hi');
        expect(runAgent).not.toHaveBeenCalled();
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(warned(fastify).some((m: string) => /paused/i.test(m))).toBe(true);
        expect(warned(fastify).some((m: string) => /quota/i.test(m))).toBe(false);
    });

    it('a reservation refused for a pause at send time is logged as a pause and suppresses the reply', async () => {
        const { kit, fastify, send } = build({ channel });
        tryReserveOutbound.mockResolvedValue({ ok: false, reason: 'paused', used: 0, limit: 100, planId: 'free' });
        await send('hi');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(kit.outbound()).toHaveLength(0);
        expect(warned(fastify).some((m: string) => /paused/i.test(m))).toBe(true);
        expect(warned(fastify).some((m: string) => /quota/i.test(m))).toBe(false);
    });

    it('a real quota refusal still logs as quota', async () => {
        const { fastify, send } = build({ channel });
        checkOutboundQuota.mockResolvedValue({ ok: false, used: 100, limit: 100, planId: 'free' });
        await send('hi');
        expect(warned(fastify).some((m: string) => /quota/i.test(m))).toBe(true);
    });
});
