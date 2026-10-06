/** POST /orders/:id/cancel: the status guard and the restock are one atomic step, so a double click never restocks twice. */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/customers.js', () => ({ resolveCustomerIdSafe: async () => null }));
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
const refundOrderPayment = vi.fn(async (_args: any) => ({ refunded: true, amountMinor: 5000 }));
vi.mock('../../services/alerts.js', () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock('../../services/order-refund.js', () => ({ refundOrderPayment: (args: any) => refundOrderPayment(args) }));

import ordersRoutes from './index.js';

async function build(status = 'PENDING', opts: { role?: string; paymentStatus?: string; collectionRoute?: string } = {}) {
    refundOrderPayment.mockClear();
    const state: { status: string; stock: number; patched?: unknown } = { status, stock: 5 };
    const tx = {
        order: {
            updateMany: vi.fn(async ({ where }: any) => {
                const ok = where.id === 'o1' && where.tenantId === 't1' &&
                    !(where.status?.notIn ?? []).includes(state.status);
                if (ok) state.status = 'CANCELLED';
                return { count: ok ? 1 : 0 };
            }),
            findFirst: vi.fn(async () => ({ id: 'o1', tenantId: 't1', status: state.status, customerPhone: '+233241234567' })),
        },
        product: { updateMany: vi.fn(async ({ data }: any) => { state.stock += data.stock.increment; return { count: 1 }; }) },
    };
    const prisma = {
        tenant: { findUnique: async () => ({ maskCustomerContact: false }) },
        order: {
            findFirst: vi.fn(async () => ({ id: 'o1', tenantId: 't1', status: state.status, paymentStatus: opts.paymentStatus ?? 'UNPAID', collectionRoute: opts.collectionRoute ?? null, items: [{ productId: 'p1', quantity: 2 }] })),
            updateMany: vi.fn(async ({ data }: any) => { if (data.status) state.status = data.status; state.patched = data; return { count: 1 }; }),
        },
        $transaction: async (fn: any) => fn(tx),
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u', tenantId: 't1', role: opts.role ?? 'OWNER' }; });
    await app.register(ordersRoutes, { prefix: '/orders' });
    return { app, state };
}

describe('POST /orders/:id/cancel', () => {
    it('cancels and restocks once', async () => {
        const { app, state } = await build();
        const res = await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(res.statusCode).toBe(200);
        expect(state).toMatchObject({ status: 'CANCELLED', stock: 7 });
    });

    it('two concurrent cancels restock exactly once (the loser gets a 400)', async () => {
        const { app, state } = await build();
        const [a, b] = await Promise.all([
            app.inject({ method: 'POST', url: '/orders/o1/cancel' }),
            app.inject({ method: 'POST', url: '/orders/o1/cancel' }),
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
        expect(state.stock).toBe(7);
    });

    it.each(['CANCELLED', 'DELIVERED'])('refuses a %s order without touching stock', async (status) => {
        const { app, state } = await build(status);
        const res = await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(res.statusCode).toBe(400);
        expect(state.stock).toBe(5);
    });

    it('an unpaid order is cancelled without a refund', async () => {
        const { app } = await build();
        await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(refundOrderPayment).not.toHaveBeenCalled();
    });

    it('STAFF cannot cancel a paid platform order (it refunds money); nothing is touched', async () => {
        const { app, state } = await build('PENDING', { role: 'STAFF', paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });
        const res = await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(res.statusCode).toBe(403);
        expect(state).toMatchObject({ status: 'PENDING', stock: 5 });
        expect(refundOrderPayment).not.toHaveBeenCalled();
    });

    it('the OWNER cancelling a paid platform order refunds the customer', async () => {
        const { app, state } = await build('PENDING', { paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });
        const res = await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(res.statusCode).toBe(200);
        expect(state.status).toBe('CANCELLED');
        expect(refundOrderPayment).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', orderId: 'o1' }));
        expect(res.json().refund).toEqual({ refunded: true, amountMinor: 5000 });
    });

    it('STAFF may cancel a paid OWN_GATEWAY order: we never held that money, so no refund runs', async () => {
        const { app } = await build('PENDING', { role: 'STAFF', paymentStatus: 'PAID', collectionRoute: 'OWN_GATEWAY' });
        const res = await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(res.statusCode).toBe(200);
        expect(refundOrderPayment).not.toHaveBeenCalled();
    });

    it('a refund that throws still returns the cancel (the refund service alerts a person)', async () => {
        const { app } = await build('PENDING', { paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });
        refundOrderPayment.mockRejectedValueOnce(new Error('boom'));
        const res = await app.inject({ method: 'POST', url: '/orders/o1/cancel' });
        expect(res.statusCode).toBe(200);
        expect(res.json().refund).toEqual({ refunded: false, reason: 'error' });
    });
});

describe('PATCH /orders/:id cannot bypass the cancel rules', () => {
    const patch = (app: any, payload: object) => app.inject({ method: 'PATCH', url: '/orders/o1', payload });

    it('status CANCELLED goes through the cancel path: stock comes back', async () => {
        const { app, state } = await build();
        const res = await patch(app, { status: 'CANCELLED' });
        expect(res.statusCode).toBe(200);
        expect(state).toMatchObject({ status: 'CANCELLED', stock: 7 });
        expect(state.patched).toBeUndefined();
    });

    it('STAFF cannot cancel a paid platform order through PATCH', async () => {
        const { app, state } = await build('PENDING', { role: 'STAFF', paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });
        const res = await patch(app, { status: 'CANCELLED' });
        expect(res.statusCode).toBe(403);
        expect(state.status).toBe('PENDING');
    });

    it('the OWNER cancelling a paid platform order through PATCH refunds it', async () => {
        const { app } = await build('PENDING', { paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });
        const res = await patch(app, { status: 'CANCELLED' });
        expect(res.statusCode).toBe(200);
        expect(refundOrderPayment).toHaveBeenCalled();
    });

    it('a cancelled order cannot be moved to another status (DELIVERED would release the customer\'s refund)', async () => {
        const { app, state } = await build('CANCELLED');
        const res = await patch(app, { status: 'DELIVERED' });
        expect(res.statusCode).toBe(400);
        expect(state.status).toBe('CANCELLED');
    });

    it('payment status of a platform-collected order is never set by hand', async () => {
        const { app, state } = await build('PENDING', { paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });
        const res = await patch(app, { paymentStatus: 'REFUNDED' });
        expect(res.statusCode).toBe(400);
        expect(state.patched).toBeUndefined();
    });

    it('CANCELLED cannot be combined with other changes', async () => {
        const { app } = await build();
        const res = await patch(app, { status: 'CANCELLED', paymentStatus: 'PAID' });
        expect(res.statusCode).toBe(400);
    });

    it('an ordinary status change still works', async () => {
        const { app, state } = await build();
        const res = await patch(app, { status: 'SHIPPED' });
        expect(res.statusCode).toBe(200);
        expect(state.status).toBe('SHIPPED');
    });
});
