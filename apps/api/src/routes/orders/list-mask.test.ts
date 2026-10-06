/** GET /orders returns the order book, so customer contacts are masked like every other order read. */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));

import ordersRoutes from './index.js';

async function build(user: Record<string, unknown>) {
    const prisma: any = {
        tenant: { findUnique: async () => ({ maskCustomerContact: true }) },
        order: {
            findMany: async () => [{ id: 'o1', customerPhone: '+233241234567', customerEmail: 'ama@example.com', items: [] }],
            count: async () => 1,
        },
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u', tenantId: 't1', ...user }; });
    await app.register(ordersRoutes, { prefix: '/orders' });
    return app;
}

describe('GET /orders masking', () => {
    it.each([[{ role: 'STAFF' }], [{ role: 'OWNER', support: true }]])('masks for %o', async (user) => {
        const res = await (await build(user)).inject({ method: 'GET', url: '/orders' });
        expect(res.statusCode).toBe(200);
        const [o] = res.json().data;
        expect(o.customerPhone).not.toBe('+233241234567');
        expect(o.customerEmail).not.toBe('ama@example.com');
    });

    it('shows contacts to the OWNER', async () => {
        const res = await (await build({ role: 'OWNER' })).inject({ method: 'GET', url: '/orders' });
        expect(res.json().data[0].customerPhone).toBe('+233241234567');
    });
});
