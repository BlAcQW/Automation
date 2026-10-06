/**
 * Staff replies while outbound messaging is paused by Bookly support. This is
 * not a quota problem: the dashboard must say so (423) instead of telling the
 * owner to upgrade (402), and must not send, store or touch the conversation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
const checkOutboundQuota = vi.fn();
vi.mock('../../services/usage.js', () => ({
    checkOutboundQuota: (...a: unknown[]) => checkOutboundQuota(...a),
    incrementMessageUsage: vi.fn(async () => undefined),
}));
vi.mock('../../services/whatsapp-credentials.js', () => ({
    selectCredentialSource: () => 'tenant',
    resolveCredentials: () => ({ accessToken: 'tok', phoneNumberId: 'ph1' }),
}));
vi.mock('../../services/media.js', () => ({
    MESSAGE_TYPE: {}, MediaError: class MediaError extends Error {}, classify: () => 'image',
    storeMedia: vi.fn(), uploadToWhatsApp: vi.fn(), deleteStoredMedia: vi.fn(), openStoredMedia: vi.fn(),
}));

import conversationsRoutes from './index.js';

const fetchMock = vi.fn();

async function build() {
    const prisma: any = {
        conversation: {
            findFirst: vi.fn(async () => ({ id: 'c1', tenantId: 't1', state: 'HUMAN_ACTIVE', customerPhone: '233241234567', lastInboundAt: new Date(), assignedUserId: null })),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        message: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(async () => ({ whatsappMsgId: 'w' })) },
        tenant: { findUnique: vi.fn(async () => ({ id: 't1' })) },
        $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const app = Fastify();
    await app.register(sensible);
    await app.register(multipart);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role: 'STAFF' }; });
    await app.register(conversationsRoutes, { prefix: '/conversations' });
    return { app, prisma };
}

const boundary = 'xBOUNDARYx';
const media = {
    body: [`--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="a.jpg"', 'Content-Type: image/jpeg', '', 'abc', `--${boundary}--`, ''].join('\r\n'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
};
const requests = {
    text: (app: any) => app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi' } }),
    media: (app: any) => app.inject({ method: 'POST', url: '/conversations/c1/media', payload: media.body, headers: media.headers }),
    rich: (app: any) => app.inject({ method: 'POST', url: '/conversations/c1/rich', payload: { type: 'reaction', messageId: 'm', emoji: '👍' } }),
};

beforeEach(() => {
    checkOutboundQuota.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe.each(Object.keys(requests) as Array<keyof typeof requests>)('staff reply (%s) while paused', (kind) => {
    it('returns 423 saying messaging is paused by Bookly support, not a quota/upgrade message', async () => {
        checkOutboundQuota.mockResolvedValue({ ok: false, paused: true, pauseReason: 'abuse review', used: 3, limit: 100, planId: 'free' });
        const { app, prisma } = await build();
        const res = await requests[kind](app);
        expect(res.statusCode).toBe(423);
        const message = res.json().message as string;
        expect(message).toMatch(/paused/i);
        expect(message).toMatch(/support/i);
        expect(message).not.toMatch(/quota|upgrade/i);
        // the internal reason is for support, not for the tenant's staff
        expect(message).not.toContain('abuse review');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(prisma.message.create).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a genuinely exhausted quota is still 402', async () => {
        checkOutboundQuota.mockResolvedValue({ ok: false, used: 100, limit: 100, planId: 'free' });
        const { app } = await build();
        expect((await requests[kind](app)).statusCode).toBe(402);
    });
});
