import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

const resolveCustomerIdSafe = vi.fn();
vi.mock('../../services/customers.js', () => ({
    resolveCustomerIdSafe: (...a: unknown[]) => resolveCustomerIdSafe(...a),
}));

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));

import { publishEvent } from '../../services/events/publish.js';
import ordersRoutes from './index.js';

const publishMock = publishEvent as unknown as ReturnType<typeof vi.fn>;

const T = 'tenant-1';

async function build() {
    const created: any[] = [];
    const tx = {
        order: {
            create: vi.fn(async ({ data }: any) => {
                created.push(data);
                return { id: 'o1', ...data, items: [] };
            }),
        },
        product: {
            // Products are read inside the transaction (createOrderAtomic).
            findMany: async () => [{ id: 'p1', name: 'Shoe', price: 10, stock: 5 }],
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
    };
    const prisma = {
        tenant: { findUnique: async () => ({ maskCustomerContact: false, paymentCurrency: 'GHS' }) },
        product: { findMany: async () => [{ id: 'p1', name: 'Shoe', price: 10, stock: 5 }] },
        $transaction: async (fn: any) => fn(tx),
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u', tenantId: T, role: 'OWNER' }; });
    await app.register(ordersRoutes, { prefix: '/orders' });
    return { app, created };
}

const body = { customerName: 'Ama', customerPhone: '+233241234567', items: [{ productId: 'p1', quantity: 2 }] };

beforeEach(() => resolveCustomerIdSafe.mockReset());

describe('POST /orders customer linking', () => {
    it('stores the customer id resolved from the phone', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cust-1');
        const { app, created } = await build();
        const res = await app.inject({ method: 'POST', url: '/orders', payload: body });
        expect(res.statusCode).toBe(200);
        expect(created[0].customerId).toBe('cust-1');
        expect(created[0].customerPhone).toBe('+233241234567');
        expect(resolveCustomerIdSafe).toHaveBeenCalledWith(
            expect.anything(),
            { tenantId: T, phone: '+233241234567', name: 'Ama' },
            expect.anything(),
        );
    });

    it('still creates the order, unlinked, when no customer could be made', async () => {
        resolveCustomerIdSafe.mockResolvedValue(null);
        const { app, created } = await build();
        const res = await app.inject({ method: 'POST', url: '/orders', payload: body });
        expect(res.statusCode).toBe(200);
        expect(created[0].customerId).toBeNull();
    });
});

describe('POST /orders order.created event', () => {
    it('publishes order.created after the order commits, in minor units', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cust-1');
        publishMock.mockReset();
        publishMock.mockResolvedValue({ eventId: 'e1' });
        const { app } = await build();
        const res = await app.inject({ method: 'POST', url: '/orders', payload: body });
        expect(res.statusCode).toBe(200);
        expect(publishMock).toHaveBeenCalledTimes(1);
        expect(publishMock.mock.calls[0][1]).toEqual({
            tenantId: T,
            type: 'order.created',
            payload: { v: 1, orderId: 'o1', customerId: 'cust-1', total: 2000, currency: 'GHS' },
        });
    });

    it('never fails the order when the publish throws', async () => {
        resolveCustomerIdSafe.mockResolvedValue(null);
        publishMock.mockReset();
        publishMock.mockRejectedValue(new Error('events db down'));
        const { app } = await build();
        const res = await app.inject({ method: 'POST', url: '/orders', payload: body });
        expect(res.statusCode).toBe(200);
    });
});

describe('POST /orders stock safety', () => {
    it('answers 409 and creates nothing durable when stock ran out (guarded decrement matched no row)', async () => {
        resolveCustomerIdSafe.mockResolvedValue(null);
        const { app } = await build();
        // Simulate the last unit being taken concurrently: the guarded
        // decrement (stock >= quantity) updates nothing.
        const appAny = app as any;
        const prisma = appAny.prisma;
        const realTx = prisma.$transaction;
        prisma.$transaction = async (fn: any) => realTx(async (tx: any) => {
            tx.product.updateMany = vi.fn(async () => ({ count: 0 }));
            return fn(tx);
        });
        const res = await app.inject({ method: 'POST', url: '/orders', payload: body });
        expect(res.statusCode).toBe(409);
    });
});
