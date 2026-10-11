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


/**
 * WhatsApp usernames (2026): a customer may hide their number. Meta then sends
 * only `from_user_id` (a business-scoped user id, BSUID) — no `from`, no
 * `contacts[].wa_id` — and replies must be addressed to that id.
 */
const BSUID = 'GH.1234567890123456';
const usernamePayload = (text: string, id: string): any => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'b', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'ph1', display_phone_number: '1' },
        contacts: [{ profile: { name: 'Kofi Mensah', username: 'kofi.rides' }, user_id: BSUID }],
        messages: [{ from_user_id: BSUID, id, timestamp: '1', type: 'text', text: { body: text } }],
    } }] }],
});

beforeEach(() => {
    for (const m of [resolveConversation, runAgent, sendChannelText, tryReserveOutbound, checkOutboundQuota, raiseAlert, publish, createFulfillmentPaymentLink, resolveCustomerIdSafe, linkConversationToCustomer]) m.mockReset();
    llmEnabled = true;
    resetPaymentFulfillersForTests();
    registerFlowPaymentFulfiller();
    tryReserveOutbound.mockResolvedValue({ ok: true });
    checkOutboundQuota.mockResolvedValue({ ok: true });
    sendChannelText.mockResolvedValue({ messageId: 'mid.OUT' });
    runAgent.mockResolvedValue({ reply: 'Hello Kofi', wantsHuman: false, toolsUsed: [] });
    createFulfillmentPaymentLink.mockImplementation(async (a: any) => {
        await a.onCreated({ reference: 'bf_f_ref1', authorizationUrl: 'https://paystack/x', collectionRoute: 'OWN_GATEWAY' });
        return 'https://paystack/x';
    });
    resolveCustomerIdSafe.mockResolvedValue(null);
    linkConversationToCustomer.mockResolvedValue(false);
});

describe('WhatsApp sender who hides their number (BSUID only)', () => {
    it('keys the conversation by the BSUID, stores no phone, and replies to the BSUID', async () => {
        const { fastify } = build({ conversation: { externalId: BSUID, customerPhone: null } });
        await processWebhook(fastify, usernamePayload('hi', 'wamid.1'));

        expect(resolveConversation).toHaveBeenCalledTimes(1);
        expect(resolveConversation.mock.calls[0][1]).toMatchObject({
            channel: 'WHATSAPP', externalId: BSUID, customerPhone: null, customerName: 'Kofi Mensah', customerHandle: 'kofi.rides',
        });
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0]).toMatchObject({ channel: 'WHATSAPP', recipientId: BSUID });
    });

    it('a message with neither a phone nor a BSUID is skipped without failing the batch', async () => {
        const { fastify } = build();
        const payload = usernamePayload('hi', 'wamid.2');
        delete payload.entry[0].changes[0].value.messages[0].from_user_id;
        await expect(processWebhook(fastify, payload)).resolves.toBeUndefined();
        expect(resolveConversation).not.toHaveBeenCalled();
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('a phone sender is unchanged: keyed and addressed by the phone', async () => {
        const { send } = build();
        await send('hi');
        expect(resolveConversation.mock.calls[0][1]).toMatchObject({ externalId: '233241234567', customerPhone: '233241234567' });
        expect(sendChannelText.mock.calls[0][0]).toMatchObject({ recipientId: '233241234567' });
    });

    it('the AI agent gets no verified phone for a BSUID sender, even one typed earlier', async () => {
        const { fastify } = build({ tenant: { vertical: 'APPOINTMENTS', conversationMode: null }, conversation: { externalId: BSUID, customerPhone: '+233201111111' } });
        await processWebhook(fastify, usernamePayload('book me', 'wamid.3'));
        expect(runAgent).toHaveBeenCalledTimes(1);
        const ctx = runAgent.mock.calls[0][0];
        expect(ctx.phoneVerified).toBe(false);
        expect(ctx.channel).toBe('WHATSAPP');
        for (const c of sendChannelText.mock.calls) expect(c[0].recipientId).toBe(BSUID);
    });

    it('the agent gets a verified phone for a normal sender', async () => {
        const { send } = build({ tenant: { vertical: 'APPOINTMENTS', conversationMode: null } });
        await send('book me');
        expect(runAgent).toHaveBeenCalledTimes(1);
        expect(runAgent.mock.calls[0][0].phoneVerified).toBe(true);
    });
});
