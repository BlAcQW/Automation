import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveConversation = vi.fn();
vi.mock('../../services/conversation-resolver.js', () => ({ resolveConversation: (...a: unknown[]) => resolveConversation(...a) }));

import { processWebhook } from './index.js';

/** A deactivated organisation's inbound messages are not handled: no conversation, no stored turn, no bot reply. */
function fastifyFor(tenant: Record<string, unknown> | null) {
    return {
        redis: null,
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        prisma: {
            tenant: { findFirst: vi.fn(async () => tenant) },
            message: { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null), update: vi.fn() },
            conversation: { update: vi.fn(async () => ({})) },
        },
    } as any;
}

const waPayload = {
    object: 'whatsapp_business_account',
    entry: [{
        id: 'waba',
        changes: [{
            field: 'messages',
            value: {
                metadata: { phone_number_id: 'pn1', display_phone_number: '233' },
                contacts: [{ wa_id: '233241234567', profile: { name: 'Ama' } }],
                messages: [{ id: 'wamid.1', from: '233241234567', timestamp: '1', type: 'text', text: { body: 'Hi' } }],
                statuses: [{ id: 'wamid.out', status: 'delivered' }],
            },
        }],
    }],
} as any;

beforeEach(() => {
    resolveConversation.mockReset();
    resolveConversation.mockResolvedValue({ id: 'c1', state: 'HUMAN_ACTIVE', botFailureCount: 0 });
});

describe('inbound webhooks for a deactivated organisation', () => {
    it('WhatsApp: the message is not processed, delivery statuses still are', async () => {
        const fastify = fastifyFor({ id: 't1', isActive: false });
        await processWebhook(fastify, waPayload);
        expect(resolveConversation).not.toHaveBeenCalled();
        expect(fastify.prisma.message.create).not.toHaveBeenCalled();
        expect(fastify.prisma.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { whatsappMsgId: 'wamid.out' } }));
        expect(fastify.log.info).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), expect.stringMatching(/deactivated/i));
    });

    it.each(['page', 'instagram'])('%s: the message is not processed', async (object) => {
        const fastify = fastifyFor({ id: 't1', isActive: false });
        await processWebhook(fastify, { object, entry: [{ id: 'acct', messaging: [{ sender: { id: 's1' }, message: { mid: 'm1', text: 'hi' } }] }] } as any);
        expect(resolveConversation).not.toHaveBeenCalled();
        expect(fastify.prisma.message.create).not.toHaveBeenCalled();
    });

    it('an active organisation is processed as before', async () => {
        const fastify = fastifyFor({ id: 't1', isActive: true });
        await processWebhook(fastify, { object: 'page', entry: [{ id: 'acct', messaging: [{ sender: { id: 's1' }, message: { mid: 'm1', text: 'hi' } }] }] } as any);
        expect(resolveConversation).toHaveBeenCalledTimes(1);
    });
});
