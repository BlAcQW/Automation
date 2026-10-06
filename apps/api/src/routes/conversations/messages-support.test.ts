/** GET /conversations/:id/messages: raw provider metadata never reaches a Bookly support viewer. */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));

import conversationsRoutes from './index.js';

async function build(user: Record<string, unknown>) {
    const prisma: any = {
        tenant: { findUnique: vi.fn(async () => ({ maskCustomerContact: true })) },
        conversation: {
            findFirst: vi.fn(async (args: any) => ({
                id: 'c1', tenantId: 't1', customerPhone: '233241234567', botContext: { collected: { phone: '0241234567' } },
                ...(args?.include?.messages ? { messages: [{ id: 'm1', content: 'hi', metadata: { from: '233241234567' } }] } : {}),
            })),
        },
        message: {
            findMany: vi.fn(async () => [
                { id: 'm1', conversationId: 'c1', content: 'hi', metadata: { from: '233241234567', profileName: 'Ama' } },
            ]),
        },
    };
    const app = Fastify();
    await app.register(sensible);
    await app.register(multipart);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', ...user }; });
    await app.register(conversationsRoutes, { prefix: '/conversations' });
    return app;
}

const get = (app: any) => app.inject({ method: 'GET', url: '/conversations/c1/messages' });

describe('GET /conversations/:id/messages metadata', () => {
    it('drops metadata for a support viewer', async () => {
        const res = await get(await build({ role: 'STAFF', support: true }));
        expect(res.statusCode).toBe(200);
        expect(res.json().data[0].metadata).toBeNull();
        expect(res.json().data[0].content).toBe('hi');
    });

    it('keeps metadata for the tenant\'s own users', async () => {
        const res = await get(await build({ role: 'OWNER' }));
        expect(res.json().data[0].metadata).toEqual({ from: '233241234567', profileName: 'Ama' });
    });
});

describe('GET /conversations/:id (the chat screen)', () => {
    const get1 = (app: any) => app.inject({ method: 'GET', url: '/conversations/c1' });

    it.each([[{ role: 'STAFF', support: true }], [{ role: 'STAFF' }]])('drops botContext and message metadata for %o', async (user) => {
        const body = (await get1(await build(user))).json();
        expect(body.botContext).toBeUndefined();
        expect(body.messages[0].metadata).toBeNull();
        expect(body.customerPhone).not.toBe('233241234567');
    });

    it('returns the full row to the OWNER', async () => {
        const body = (await get1(await build({ role: 'OWNER' }))).json();
        expect(body.messages[0].metadata).toEqual({ from: '233241234567' });
        expect(body.customerPhone).toBe('233241234567');
    });

    it('masked STAFF also lose metadata on the paginated messages endpoint', async () => {
        const res = await get(await build({ role: 'STAFF' }));
        expect(res.json().data[0].metadata).toBeNull();
    });
});
