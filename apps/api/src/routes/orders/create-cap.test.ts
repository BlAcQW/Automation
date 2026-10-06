/**
 * POST /orders quantity limits. createOrderAtomic caps chat orders at 100 per
 * product; the dashboard must keep accepting wholesale quantities (up to
 * DASHBOARD_MAX_LINE_QUANTITY) and say so clearly beyond that: a 400 naming
 * the cap, never a 500 and never a silent 100 limit.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/customers.js', () => ({ resolveCustomerIdSafe: async () => null }));
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));

import ordersRoutes from './index.js';
import { DASHBOARD_MAX_LINE_QUANTITY } from '../../services/order-create.js';

async function build(stock = 1_000_000) {
    const created: any[] = [];
    const decrements: number[] = [];
    const tx = {
        order: { create: vi.fn(async ({ data }: any) => { created.push(data); return { id: 'o1', ...data, items: [] }; }) },
        product: {
            findMany: async () => [{ id: 'p1', name: 'Shoe', price: 1, stock }],
            updateMany: vi.fn(async ({ data }: any) => { decrements.push(data.stock.decrement); return { count: 1 }; }),
        },
    };
    const prisma = {
        tenant: { findUnique: async () => ({ maskCustomerContact: false, paymentCurrency: 'GHS' }) },
        $transaction: async (fn: any) => fn(tx),
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u', tenantId: 't1', role: 'OWNER' }; });
    await app.register(ordersRoutes, { prefix: '/orders' });
    return { app, created, decrements };
}

const post = (app: any, items: unknown) => app.inject({
    method: 'POST', url: '/orders',
    payload: { customerName: 'Ama', customerPhone: '+233241234567', items },
});

describe('POST /orders quantity limits', () => {
    it('accepts a wholesale quantity above the chat cap of 100', async () => {
        const { app, created, decrements } = await build();
        const res = await post(app, [{ productId: 'p1', quantity: 5000 }]);
        expect(res.statusCode).toBe(200);
        expect(created[0].items.create[0].quantity).toBe(5000);
        expect(decrements).toEqual([5000]);
    });

    it('accepts exactly the dashboard cap', async () => {
        const { app } = await build();
        expect((await post(app, [{ productId: 'p1', quantity: DASHBOARD_MAX_LINE_QUANTITY }])).statusCode).toBe(200);
    });

    it('returns a clear 400 naming the cap above it, and creates nothing', async () => {
        const { app, created } = await build();
        const res = await post(app, [{ productId: 'p1', quantity: DASHBOARD_MAX_LINE_QUANTITY + 1 }]);
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain(String(DASHBOARD_MAX_LINE_QUANTITY));
        expect(created).toHaveLength(0);
    });

    it('applies the cap to duplicate lines of one product combined, with a 400', async () => {
        const { app, created } = await build();
        const res = await post(app, [
            { productId: 'p1', quantity: 6000 }, { productId: 'p1', quantity: 6000 },
        ]);
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/p1|same product|combined/i);
        expect(created).toHaveLength(0);
    });

    it('merges duplicate lines under the cap into one line (documented behaviour)', async () => {
        const { app, created } = await build();
        const res = await post(app, [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 3 }]);
        expect(res.statusCode).toBe(200);
        expect(created[0].items.create).toEqual([expect.objectContaining({ productId: 'p1', quantity: 5 })]);
    });

    it('rejects fractional, zero and negative quantities with 400', async () => {
        const { app } = await build();
        for (const q of [0, -1, 1.5]) {
            expect((await post(app, [{ productId: 'p1', quantity: q }])).statusCode).toBe(400);
        }
    });
});
