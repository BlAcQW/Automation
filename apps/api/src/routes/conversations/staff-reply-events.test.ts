/**
 * Staff replies from the dashboard: message.sent (HUMAN) only when the message
 * was actually sent, and the bot -> human flip is a conditional update that
 * sets takeoverAt and is announced only by the call that really changed it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('../../services/usage.js', () => ({
    checkOutboundQuota: vi.fn(async () => ({ ok: true })),
    incrementMessageUsage: vi.fn(async () => undefined),
}));
let creds: { accessToken: string; phoneNumberId: string } | null = { accessToken: 'tok', phoneNumberId: 'ph1' };
vi.mock('../../services/whatsapp-credentials.js', () => ({
    selectCredentialSource: () => 'tenant',
    resolveCredentials: () => creds,
}));
vi.mock('../../services/media.js', () => ({
    MESSAGE_TYPE: { image: 'IMAGE', video: 'VIDEO', audio: 'AUDIO', sticker: 'STICKER', document: 'DOCUMENT' },
    MediaError: class MediaError extends Error {},
    classify: () => 'image',
    storeMedia: vi.fn(async () => ({ relativePath: 't1/x.jpg', mimeType: 'image/jpeg', size: 3, kind: 'image' })),
    uploadToWhatsApp: vi.fn(async () => 'media-1'),
    deleteStoredMedia: vi.fn(async () => undefined),
    openStoredMedia: vi.fn(),
}));

import { publishEvent } from '../../services/events/publish.js';
import conversationsRoutes from './index.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();

async function build(conversation: Record<string, unknown> | null, opts: { flipCount?: number } = {}) {
    const flipCount = opts.flipCount ?? 1;
    const prisma: any = {
        conversation: {
            findFirst: vi.fn(async () => conversation),
            // The guarded flip carries a state condition; a plain touch does not.
            updateMany: vi.fn(async ({ where }: any) => ({ count: where.state ? flipCount : 1 })),
        },
        message: {
            create: vi.fn(async ({ data }: any) => ({ id: 'm1', ...data })),
            update: vi.fn(async () => ({})),
            findFirst: vi.fn(async () => ({ whatsappMsgId: 'wamid.target' })),
        },
        tenant: { findUnique: vi.fn(async () => ({ id: 't1' })) },
        $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const app = Fastify();
    await app.register(sensible);
    await app.register(multipart);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role: 'OWNER' }; });
    await app.register(conversationsRoutes, { prefix: '/conversations' });
    return { app, prisma };
}

const conv = (state: string) => ({
    id: 'c1', tenantId: 't1', state, customerPhone: '233241234567', lastInboundAt: new Date(), assignedUserId: null,
});
const types = () => publish.mock.calls.map((c) => (c[1] as any).type);
const sent = () => publish.mock.calls.map((c) => c[1] as any).filter((e) => e.type === 'message.sent');
const flips = (prisma: any) => prisma.conversation.updateMany.mock.calls.map((c: any) => c[0]).filter((a: any) => a.where.state);

const multipartBody = () => {
    const boundary = 'xBOUNDARYx';
    const body = [
        `--${boundary}`, 'Content-Disposition: form-data; name="caption"', '', 'hello',
        `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="a.jpg"', 'Content-Type: image/jpeg', '', 'abc',
        `--${boundary}--`, '',
    ].join('\r\n');
    return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
    creds = { accessToken: 'tok', phoneNumberId: 'ph1' };
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OUT' }] }) });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('POST /conversations/:id/messages', () => {
    it('announces message.sent (HUMAN) once the text was actually sent', async () => {
        const { app } = await build(conv('HUMAN_ACTIVE'), { flipCount: 0 });
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } });
        expect(res.statusCode).toBe(200);
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({
            tenantId: 't1', payload: { v: 1, conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP', sentBy: 'HUMAN' },
        });
    });

    it('does NOT announce message.sent when WhatsApp rejects it', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'nope' }) });
        const { app } = await build(conv('HUMAN_ACTIVE'), { flipCount: 0 });
        await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } });
        expect(sent()).toHaveLength(0);
    });

    it('does NOT announce message.sent when the send throws or no number is connected', async () => {
        fetchMock.mockRejectedValue(new Error('network'));
        const a = await build(conv('HUMAN_ACTIVE'), { flipCount: 0 });
        await a.app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } });
        expect(sent()).toHaveLength(0);

        creds = null;
        const b = await build(conv('HUMAN_ACTIVE'), { flipCount: 0 });
        await b.app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } });
        expect(sent()).toHaveLength(0);
    });

    it('flips bot -> human with a CONDITIONAL update that sets takeoverAt, and announces the handoff once', async () => {
        const { app, prisma } = await build(conv('BOT_ACTIVE'));
        await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } });
        const flip = flips(prisma);
        expect(flip).toHaveLength(1);
        expect(flip[0].where).toMatchObject({ id: 'c1', tenantId: 't1', state: { not: 'HUMAN_ACTIVE' } });
        expect(flip[0].data).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverAt: expect.any(Date) });
        expect(types().filter((t) => t === 'conversation.handoff')).toHaveLength(1);
    });

    it('a staff reply that loses the flip race (count 0) does not announce a second handoff', async () => {
        const { app } = await build(conv('BOT_ACTIVE'), { flipCount: 0 }); // another request flipped it first
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } });
        expect(res.statusCode).toBe(200);
        expect(types()).not.toContain('conversation.handoff');
        expect(types()).toContain('message.sent');
    });
});

describe('POST /conversations/:id/media', () => {
    it('announces message.sent (HUMAN) with the stored message id, plus one guarded handoff with takeoverAt', async () => {
        const { app, prisma } = await build(conv('BOT_ACTIVE'));
        const { body, headers } = multipartBody();
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/media', payload: body, headers });
        expect(res.statusCode).toBe(200);
        expect(sent()).toHaveLength(1);
        expect(sent()[0].payload).toMatchObject({ v: 1, conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP', sentBy: 'HUMAN' });
        expect(flips(prisma)[0].data).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverAt: expect.any(Date) });
        expect(types().filter((t) => t === 'conversation.handoff')).toHaveLength(1);
    });

    it('announces nothing when WhatsApp rejects the attachment', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
        const { app } = await build(conv('BOT_ACTIVE'));
        const { body, headers } = multipartBody();
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/media', payload: body, headers });
        expect(res.statusCode).toBe(502);
        expect(sent()).toHaveLength(0);
        expect(types()).not.toContain('conversation.handoff');
    });

    it('a lost flip race does not announce a second handoff', async () => {
        const { app } = await build(conv('BOT_ACTIVE'), { flipCount: 0 });
        const { body, headers } = multipartBody();
        await app.inject({ method: 'POST', url: '/conversations/c1/media', payload: body, headers });
        expect(types()).not.toContain('conversation.handoff');
        expect(sent()).toHaveLength(1);
    });
});

describe('POST /conversations/:id/rich', () => {
    const location = { type: 'location', latitude: 5.6, longitude: -0.18, name: 'Gate' };

    it('announces message.sent (HUMAN) for a location, with a guarded handoff that sets takeoverAt', async () => {
        const { app, prisma } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/rich', payload: location });
        expect(res.statusCode).toBe(200);
        expect(sent()[0].payload).toMatchObject({ conversationId: 'c1', messageId: 'm1', channel: 'WHATSAPP', sentBy: 'HUMAN' });
        expect(flips(prisma)[0].data).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverAt: expect.any(Date) });
        expect(types().filter((t) => t === 'conversation.handoff')).toHaveLength(1);
    });

    it('a reaction is sent (message.sent) but never takes the conversation over', async () => {
        const { app, prisma } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/rich', payload: { type: 'reaction', messageId: 'm0', emoji: '👍' } });
        expect(res.statusCode).toBe(200);
        expect(sent()).toHaveLength(1);
        expect(flips(prisma)).toHaveLength(0);
        expect(types()).not.toContain('conversation.handoff');
    });

    it('announces nothing when WhatsApp rejects it', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
        const { app } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/rich', payload: location });
        expect(res.statusCode).toBe(502);
        expect(publish).not.toHaveBeenCalled();
    });

    it('a lost flip race does not announce a second handoff', async () => {
        const { app } = await build(conv('BOT_ACTIVE'), { flipCount: 0 });
        await app.inject({ method: 'POST', url: '/conversations/c1/rich', payload: location });
        expect(types()).not.toContain('conversation.handoff');
    });
});

describe('POST /conversations/:id/activate-human', () => {
    it('uses a conditional update, sets takeoverAt and announces once', async () => {
        const { app, prisma } = await build(conv('BOT_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/activate-human' });
        expect(res.statusCode).toBe(200);
        expect(flips(prisma)[0].where).toMatchObject({ id: 'c1', tenantId: 't1', state: { not: 'HUMAN_ACTIVE' } });
        expect(flips(prisma)[0].data).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverAt: expect.any(Date) });
        expect(types()).toEqual(['conversation.handoff']);
    });

    it('two racing activations announce once: the loser (count 0) answers 200 and stays silent', async () => {
        const { app } = await build(conv('BOT_ACTIVE'), { flipCount: 0 });
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/activate-human' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: 'c1', state: 'HUMAN_ACTIVE' });
        expect(publish).not.toHaveBeenCalled();
    });
});

describe('POST /conversations/:id/resume-bot', () => {
    it('clears takeoverAt (and the takeover reason/assignee) and announces once', async () => {
        const { app, prisma } = await build(conv('HUMAN_ACTIVE'));
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/resume-bot' });
        expect(res.statusCode).toBe(200);
        const call = prisma.conversation.updateMany.mock.calls[0][0];
        expect(call.where).toMatchObject({ id: 'c1', tenantId: 't1', state: 'HUMAN_ACTIVE' });
        expect(call.data).toMatchObject({ state: 'BOT_ACTIVE', takeoverAt: null, takeoverReason: null, assignedUserId: null });
        expect(types()).toEqual(['conversation.resumed']);
    });

    it('a resume that loses the race (state already changed, count 0) is a 400 with no event and no system message', async () => {
        const { app, prisma } = await build(conv('HUMAN_ACTIVE'), { flipCount: 0 });
        prisma.conversation.updateMany.mockResolvedValue({ count: 0 });
        const res = await app.inject({ method: 'POST', url: '/conversations/c1/resume-bot' });
        expect(res.statusCode).toBe(400);
        expect(publish).not.toHaveBeenCalled();
        expect(prisma.message.create).not.toHaveBeenCalled();
    });
});
