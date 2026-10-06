import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('../../services/usage.js', () => ({
    checkOutboundQuota: vi.fn(async () => ({ ok: true })),
    incrementMessageUsage: vi.fn(async () => undefined),
}));

import { publishEvent } from '../../services/events/publish.js';
import conversationsRoutes from './index.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

async function build(conversation: Record<string, unknown> | null, opts: { count?: number } = {}) {
    const prisma: any = {
        conversation: {
            findFirst: vi.fn(async () => conversation),
            updateMany: vi.fn(async () => ({ count: opts.count ?? 1 })),
        },
        message: { create: vi.fn(async ({ data }: any) => ({ id: 'm1', ...data })) },
        tenant: { findUnique: vi.fn(async () => ({ id: 't1' })) },
        $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role: 'OWNER' }; });
    await app.register(conversationsRoutes, { prefix: '/conversations' });
    return { app, prisma };
}

const conv = (state: string) => ({
    id: 'c1', tenantId: 't1', state, customerPhone: '233241234567', lastInboundAt: new Date(), assignedUserId: null,
});
const types = () => publish.mock.calls.map((c) => (c[1] as any).type);

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('POST /conversations/:id/resume-bot', () => {
    it('publishes conversation.resumed once the conversation is back with the assistant', async () => {
        const { app } = await build(conv('HUMAN_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/resume-bot' });
        expect(res.statusCode).toBe(200);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toMatchObject({
            tenantId: 't1', type: 'conversation.resumed', payload: { v: 1, conversationId: 'c1' },
        });
    });

    it('publishes nothing when the bot was already active (400)', async () => {
        const { app } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/resume-bot' });
        expect(res.statusCode).toBe(400);
        expect(publish).not.toHaveBeenCalled();
    });

    it('does not fail the resume when the publish throws', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const { app } = await build(conv('HUMAN_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/resume-bot' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: 'c1', state: 'BOT_ACTIVE' });
    });
});

describe('manual takeover from the dashboard', () => {
    it('activate-human publishes conversation.handoff when the bot was in charge', async () => {
        const { app } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/activate-human' });
        expect(res.statusCode).toBe(200);
        expect(publish.mock.calls[0][1]).toMatchObject({
            tenantId: 't1', type: 'conversation.handoff', payload: { v: 1, conversationId: 'c1', to: 'HUMAN', reason: 'manual' },
        });
    });

    it('activate-human is silent when a human already had it', async () => {
        const { app } = await build(conv('HUMAN_ACTIVE'), { count: 0 });
        await app.inject({ method: 'POST', url: '/conversations/c1/activate-human' });
        expect(publish).not.toHaveBeenCalled();
    });

    it('a staff reply into a bot conversation announces the takeover it causes', async () => {
        const { app } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi, this is Kofi' } });
        expect(res.statusCode).toBe(200);
        expect(types()).toEqual(['conversation.handoff']);
        expect((publish.mock.calls[0][1] as any).payload.reason).toBe('staff_reply');
    });

    it('a staff reply into a conversation a human already has publishes nothing', async () => {
        const { app } = await build(conv('HUMAN_ACTIVE'), { count: 0 });
        await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hello' } });
        expect(publish).not.toHaveBeenCalled();
    });

    it('never fails the reply when the publish throws', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const { app } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hello' } });
        expect(res.statusCode).toBe(200);
    });
});
