/** GET /conversations tells the dashboard which channel each chat is on, with the Instagram handle (masked like contacts). */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));

import conversationsRoutes from './index.js';

async function list(role: 'OWNER' | 'STAFF') {
    const prisma: any = {
        tenant: { findUnique: vi.fn(async () => ({ maskCustomerContact: true })) },
        conversation: {
            findMany: vi.fn(async () => [{
                id: 'c1', channel: 'INSTAGRAM', customerPhone: null, customerName: 'Ama', customerHandle: 'ama.styles',
                state: 'BOT_ACTIVE', updatedAt: new Date(), messages: [{ content: 'hi', createdAt: new Date(), direction: 'INBOUND' }],
            }]),
            count: vi.fn(async () => 1),
        },
    };
    const app = Fastify();
    await app.register(sensible);
    await app.register(multipart);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role }; });
    await app.register(conversationsRoutes, { prefix: '/conversations' });
    return (await app.inject({ method: 'GET', url: '/conversations' })).json().data[0];
}

describe('GET /conversations channel fields', () => {
    it('includes the channel and the Instagram handle for the owner', async () => {
        expect(await list('OWNER')).toMatchObject({ channel: 'INSTAGRAM', customerHandle: 'ama.styles', customerPhone: null });
    });
    it('masks the handle for masked staff', async () => {
        const row = await list('STAFF');
        expect(row.channel).toBe('INSTAGRAM');
        expect(row.customerHandle).not.toBe('ama.styles');
    });
});
