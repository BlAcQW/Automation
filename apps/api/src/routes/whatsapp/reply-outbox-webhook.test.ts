import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveConversation = vi.fn();
vi.mock('../../services/conversation-resolver.js', () => ({ resolveConversation: (...a: unknown[]) => resolveConversation(...a) }));
const runAgent = vi.fn();
vi.mock('../../services/llm-agent.js', () => ({ runAgent: (...a: unknown[]) => runAgent(...a), isLlmEnabled: () => true }));
const sendChannelText = vi.fn();
vi.mock('../../services/channel-send.js', async (orig) => ({
    ...(await orig<typeof import('../../services/channel-send.js')>()),
    sendChannelText: (...a: unknown[]) => sendChannelText(...a),
}));
const tryReserveOutbound = vi.fn();
const rollbackOutboundReservation = vi.fn();
vi.mock('../../services/usage.js', () => ({
    checkOutboundQuota: async () => ({ ok: true }),
    tryReserveOutbound: (...a: unknown[]) => tryReserveOutbound(...a),
    rollbackOutboundReservation: (...a: unknown[]) => rollbackOutboundReservation(...a),
}));
vi.mock('../../services/crypto.js', async (orig) => ({ ...(await orig<any>()), decrypt: (v: string) => `dec:${v}` }));
vi.mock('../../services/alerts.js', () => ({ raiseAlert: vi.fn() }));

import { processWebhook } from './index.js';

type Msg = Record<string, any>;
function build() {
    const messages: Msg[] = [];
    const match = (m: Msg, w: any) => Object.entries(w).every(([k, v]) => k === 'metadata' || k === 'createdAt' || m[k] === v);
    const message = {
        findFirst: vi.fn(async ({ where }: any) => messages.find((m) => match(m, where)) ?? null),
        create: vi.fn(async ({ data }: any) => { const r = { id: `m${messages.length}`, handledAt: null, ...data }; messages.push(r); return r; }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const m of messages.filter((x) => x.id === where.id)) { Object.assign(m, data); count++; }
            return { count };
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(messages.find((x) => x.id === where.id)!, data)),
    };
    const fastify: any = {
        redis: null, queues: {},
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        prisma: {
            tenant: { findFirst: vi.fn(async () => ({ id: 't1', facebookPageId: 'pg', facebookPageToken: 'tok', vertical: 'APPOINTMENTS' })) },
            message,
            conversation: { update: vi.fn(async () => ({})) },
        },
    };
    return { fastify, messages };
}
const payload = (): any => ({
    object: 'page',
    entry: [{ id: 'p1', messaging: [{ sender: { id: 's1' }, message: { mid: 'm-1', text: 'book me' } }] }],
});
const outbound = (ms: Msg[]) => ms.filter((m) => m.direction === 'OUTBOUND');

beforeEach(() => {
    for (const m of [resolveConversation, runAgent, sendChannelText, tryReserveOutbound, rollbackOutboundReservation]) m.mockReset();
    resolveConversation.mockResolvedValue({ id: 'c1', state: 'BOT_ACTIVE', botFailureCount: 0, customerPhone: null });
    runAgent.mockResolvedValue({ reply: 'Booked for 3pm', wantsHuman: false, toolsUsed: ['create_booking'] });
    tryReserveOutbound.mockResolvedValue({ ok: true });
    rollbackOutboundReservation.mockResolvedValue(undefined);
    sendChannelText.mockResolvedValue({ messageId: 'mid.OUT' });
});

describe('agent reply outbox through the webhook', () => {
    it('success: reply row SENT, inbound handled', async () => {
        const { fastify, messages } = build();
        await processWebhook(fastify, payload());
        const inbound = messages.find((m) => m.direction === 'INBOUND')!;
        expect(inbound.handledAt).toBeInstanceOf(Date);
        expect(outbound(messages)).toHaveLength(1);
        expect(outbound(messages)[0]).toMatchObject({ sendState: 'SENT', replyToId: inbound.id, whatsappMsgId: 'mid.OUT', content: 'Booked for 3pm' });
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
    });

    it('send failure: not handled, reply stays PENDING, quota rolled back, turn throws, no fallback/handoff message', async () => {
        const { fastify, messages } = build();
        sendChannelText.mockRejectedValue(new Error('graph down'));
        await expect(processWebhook(fastify, payload())).rejects.toThrow(/webhook item/);
        const inbound = messages.find((m) => m.direction === 'INBOUND')!;
        expect(inbound.handledAt).toBeNull();
        expect(outbound(messages)).toHaveLength(1); // only the outbox row, no holding message
        expect(outbound(messages)[0]).toMatchObject({ sendState: 'PENDING', replyToId: inbound.id });
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
        expect(tryReserveOutbound).toHaveBeenCalledTimes(1);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
    });

    it('retry re-sends the stored text WITHOUT calling the agent again, then marks the inbound handled', async () => {
        const { fastify, messages } = build();
        sendChannelText.mockRejectedValueOnce(new Error('graph down'));
        await expect(processWebhook(fastify, payload())).rejects.toThrow();
        expect(runAgent).toHaveBeenCalledTimes(1);

        await processWebhook(fastify, payload()); // inbox retry
        expect(runAgent).toHaveBeenCalledTimes(1); // tools like create_booking are not re-run
        expect(sendChannelText).toHaveBeenCalledTimes(2);
        expect((sendChannelText.mock.calls[1] as any)[0].text).toBe('Booked for 3pm');
        expect(outbound(messages)).toHaveLength(1);
        expect(outbound(messages)[0].sendState).toBe('SENT');
        expect(messages.find((m) => m.direction === 'INBOUND')!.handledAt).toBeInstanceOf(Date);
        // reserved twice (once per attempt), rolled back once (the failed one)
        expect(tryReserveOutbound).toHaveBeenCalledTimes(2);
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
    });
});
