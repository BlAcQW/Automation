/**
 * Staff replies on Instagram and Messenger go out on THAT channel, to the
 * customer's channel id, signed by the Page token. They never fall back to
 * WhatsApp: an IG customer usually has no phone, and a typed one could be
 * someone else's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn(async () => ({ eventId: 'e1' })) }));
vi.mock('../../services/usage.js', () => ({
    checkOutboundQuota: vi.fn(async () => ({ ok: true })),
    incrementMessageUsage: vi.fn(async () => undefined),
}));
vi.mock('../../services/crypto.js', () => ({ decrypt: (v: string) => `dec:${v}`, encrypt: (v: string) => v }));
vi.mock('../../services/whatsapp-credentials.js', () => ({
    selectCredentialSource: () => 'tenant',
    resolveCredentials: () => ({ accessToken: 'wa-tok', phoneNumberId: 'ph1' }),
}));

import { publishEvent } from '../../services/events/publish.js';
import conversationsRoutes from './index.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;
const fetchMock = vi.fn();

async function build(channel: 'INSTAGRAM' | 'MESSENGER', tenant: Record<string, unknown>) {
    const prisma: any = {
        conversation: {
            findFirst: vi.fn(async () => ({
                id: 'c1', tenantId: 't1', state: 'HUMAN_ACTIVE', channel, externalId: 'scoped-123',
                customerPhone: channel === 'INSTAGRAM' ? '+233200000000' : null, lastInboundAt: new Date(), assignedUserId: null,
            })),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        message: { create: vi.fn(async ({ data }: any) => ({ id: 'm1', ...data })), update: vi.fn(async () => ({})) },
        tenant: { findUnique: vi.fn(async () => ({ id: 't1', ...tenant })) },
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

const connected = { facebookPageId: 'page1', facebookPageToken: 'enc-page-tok', instagramUserId: 'ig1' };
const reply = (app: any) => app.inject({ method: 'POST', url: '/conversations/c1/messages', payload: { content: 'Hi from staff' } });
const sentEvents = () => publish.mock.calls.map((c) => c[1] as any).filter((e) => e.type === 'message.sent');

beforeEach(() => {
    publish.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message_id: 'mid.OUT' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('staff reply on Instagram / Messenger', () => {
    it.each([['INSTAGRAM', 'ig1'], ['MESSENGER', 'page1']] as const)('%s: sent as %s to the customer\'s channel id with the Page token, never WhatsApp', async (channel, sender) => {
        const { app } = await build(channel, connected);
        const res = await reply(app);
        expect(res.statusCode).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(new RegExp(`/${sender}/messages$`));
        expect(String(url)).not.toContain('ph1');
        expect(init.headers.Authorization).toBe('Bearer dec:enc-page-tok');
        expect(JSON.parse(init.body)).toMatchObject({ recipient: { id: 'scoped-123' }, message: { text: 'Hi from staff' } });
        expect(sentEvents()[0]?.payload).toMatchObject({ channel, sentBy: 'HUMAN' });
    });

    it('a channel that is not connected is refused before anything is stored or sent', async () => {
        const { app, prisma } = await build('INSTAGRAM', { facebookPageId: null, facebookPageToken: null, instagramUserId: null });
        const res = await reply(app);
        expect(res.statusCode).toBe(422);
        expect(prisma.message.create).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a provider failure is not announced as sent', async () => {
        fetchMock.mockResolvedValue(new Response('{"error":{}}', { status: 400 }));
        const { app } = await build('MESSENGER', connected);
        await reply(app);
        expect(sentEvents()).toHaveLength(0);
    });

    it('attachments and reactions are refused with a clear message (not sent over WhatsApp)', async () => {
        const { app } = await build('INSTAGRAM', connected);
        const rich = await app.inject({ method: 'POST', url: '/conversations/c1/rich', payload: { type: 'reaction', messageId: 'm', emoji: '👍' } });
        expect(rich.statusCode).toBe(422);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
