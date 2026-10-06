/**
 * Unpaid-order expiry. An order waiting on an online payment holds stock; if
 * the customer walks away it must be cancelled and restocked, exactly once,
 * even with several sweepers running and even if a payment lands mid-sweep.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    expireUnpaidOrders, cancelOrderAndRestock, orderExpiryMinutes, ORDER_EXPIRY_MINUTES_DEFAULT,
} from './order-expiry.js';

const NOW = new Date('2030-01-01T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

interface O { id: string; tenantId: string; orderRef: string; customerName: string; status: string; paymentStatus: string; createdAt: Date; paymentAuthorizationUrl: string | null; items: Array<{ productId: string; quantity: number }> }

/** In-memory prisma. updateMany honours the guard; $transaction rolls back on throw. */
function fake(orders: O[], stock: Record<string, number>) {
    const state = { orders: orders.map((o) => ({ ...o })), stock: { ...stock } };
    const notes: any[] = [];
    const match = (o: O, w: any) =>
        (w.id === undefined || o.id === w.id) &&
        (w.tenantId === undefined || o.tenantId === w.tenantId) &&
        (w.status === undefined || (typeof w.status === 'string' ? o.status === w.status : w.status.notIn ? !w.status.notIn.includes(o.status) : true)) &&
        (w.paymentStatus === undefined || o.paymentStatus === w.paymentStatus) &&
        (w.createdAt?.lt === undefined || o.createdAt < w.createdAt.lt) &&
        (w.paymentAuthorizationUrl?.not === undefined || o.paymentAuthorizationUrl !== null);
    const tx = {
        order: {
            findMany: vi.fn(async ({ where, take }: any) =>
                state.orders.filter((o) => match(o, where)).slice(0, take ?? 1000).map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })) }))),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const hit = state.orders.filter((o) => match(o, where));
                for (const o of hit) Object.assign(o, data);
                return { count: hit.length };
            }),
        },
        product: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (!(where.id in state.stock)) return { count: 0 };
                state.stock[where.id] += data.stock.increment;
                return { count: 1 };
            }),
        },
        notification: { create: vi.fn(async ({ data }: any) => { notes.push(data); return data; }) },
    };
    const prisma: any = {
        ...tx,
        $transaction: async (fn: any) => {
            const snap = JSON.parse(JSON.stringify(state));
            try { return await fn(tx); } catch (e) {
                state.orders = snap.orders.map((o: any) => ({ ...o, createdAt: new Date(o.createdAt) }));
                state.stock = snap.stock;
                throw e;
            }
        },
    };
    return { prisma, state, tx, notes };
}

const order = (over: Partial<O> = {}): O => ({
    id: 'o1', tenantId: 't1', orderRef: 'ORD-1', customerName: 'Ama', status: 'PENDING', paymentStatus: 'UNPAID',
    createdAt: ago(90), paymentAuthorizationUrl: 'https://pay/1', items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }], ...over,
});

describe('orderExpiryMinutes', () => {
    it('defaults to 60 and reads ORDER_EXPIRY_MINUTES', () => {
        expect(ORDER_EXPIRY_MINUTES_DEFAULT).toBe(60);
        expect(orderExpiryMinutes({})).toBe(60);
        expect(orderExpiryMinutes({ ORDER_EXPIRY_MINUTES: '120' })).toBe(120);
    });
    it.each(['abc', '0', '-5', '', '2'])('falls back to the default (or a safe floor) for %j', (v) => {
        expect(orderExpiryMinutes({ ORDER_EXPIRY_MINUTES: v })).toBeGreaterThanOrEqual(5);
    });
});

describe('expireUnpaidOrders', () => {
    it('cancels an old unpaid pending order and restocks every line', async () => {
        const { prisma, state, notes } = fake([order()], { p1: 3, p2: 0 });
        const n = await expireUnpaidOrders(prisma, undefined, NOW);
        expect(n).toBe(1);
        expect(state.orders[0].status).toBe('CANCELLED');
        expect(state.stock).toEqual({ p1: 5, p2: 1 });
        expect(notes[0]).toMatchObject({ tenantId: 't1', type: 'SYSTEM' });
    });

    it('leaves a recent order alone', async () => {
        const { prisma, state } = fake([order({ createdAt: ago(10) })], { p1: 3, p2: 0 });
        expect(await expireUnpaidOrders(prisma, undefined, NOW)).toBe(0);
        expect(state.orders[0].status).toBe('PENDING');
        expect(state.stock).toEqual({ p1: 3, p2: 0 });
    });

    it('never touches paid, confirmed or already cancelled orders', async () => {
        const { prisma, state } = fake([
            order({ id: 'a', paymentStatus: 'PAID', status: 'CONFIRMED' }),
            order({ id: 'b', status: 'CANCELLED' }),
            order({ id: 'c', status: 'PROCESSING' }),
        ], { p1: 3, p2: 0 });
        expect(await expireUnpaidOrders(prisma, undefined, NOW)).toBe(0);
        expect(state.stock).toEqual({ p1: 3, p2: 0 });
    });

    it('does not expire an order with no online payment link (cash / arranged by staff)', async () => {
        const { prisma, state } = fake([order({ paymentAuthorizationUrl: null })], { p1: 3, p2: 0 });
        expect(await expireUnpaidOrders(prisma, undefined, NOW)).toBe(0);
        expect(state.orders[0].status).toBe('PENDING');
    });

    it('respects a custom window', async () => {
        const { prisma } = fake([order({ createdAt: ago(90) })], { p1: 3, p2: 0 });
        expect(await expireUnpaidOrders(prisma, undefined, NOW, 120)).toBe(0);
    });

    it('never double-restocks when two sweepers run at once', async () => {
        const { prisma, state } = fake([order()], { p1: 3, p2: 0 });
        const [a, b] = await Promise.all([
            expireUnpaidOrders(prisma, undefined, NOW),
            expireUnpaidOrders(prisma, undefined, NOW),
        ]);
        expect(a + b).toBe(1);
        expect(state.stock).toEqual({ p1: 5, p2: 1 });
    });

    it('a payment landing between the read and the claim wins: no cancel, no restock', async () => {
        const { prisma, state, tx } = fake([order()], { p1: 3, p2: 0 });
        const realFind = tx.order.findMany;
        tx.order.findMany = vi.fn(async (a: any) => {
            const rows = await realFind(a);
            state.orders[0].paymentStatus = 'PAID'; // webhook lands after the sweep read the row
            state.orders[0].status = 'CONFIRMED';
            return rows;
        }) as any;
        expect(await expireUnpaidOrders(prisma, undefined, NOW)).toBe(0);
        expect(state.orders[0].status).toBe('CONFIRMED');
        expect(state.stock).toEqual({ p1: 3, p2: 0 });
    });

    it('rolls the cancel back if restocking fails, and keeps sweeping the rest', async () => {
        const { prisma, state, tx } = fake([order({ id: 'bad' }), order({ id: 'good', items: [{ productId: 'p1', quantity: 1 }] })], { p1: 3, p2: 0 });
        const realUpdate = tx.product.updateMany;
        let first = true;
        tx.product.updateMany = vi.fn(async (a: any) => {
            if (first) { first = false; throw new Error('db blip'); }
            return realUpdate(a);
        }) as any;
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        expect(await expireUnpaidOrders(prisma, log, NOW)).toBe(1);
        expect(state.orders.find((o) => o.id === 'bad')!.status).toBe('PENDING');
        expect(state.orders.find((o) => o.id === 'good')!.status).toBe('CANCELLED');
        expect(log.error).toHaveBeenCalled();
    });

    it('a product that no longer exists does not block the cancel', async () => {
        const { prisma, state } = fake([order()], { p1: 3 }); // p2 deleted
        expect(await expireUnpaidOrders(prisma, undefined, NOW)).toBe(1);
        expect(state.stock.p1).toBe(5);
    });
});

describe('cancelOrderAndRestock (shared with POST /orders/:id/cancel)', () => {
    it('is guarded: a second cancel of the same order restocks nothing', async () => {
        const { prisma, state } = fake([order()], { p1: 3, p2: 0 });
        const args = { tenantId: 't1', orderId: 'o1', items: order().items, guard: { status: { notIn: ['CANCELLED', 'DELIVERED'] } } };
        expect(await cancelOrderAndRestock(prisma, args as any)).toBe(true);
        expect(await cancelOrderAndRestock(prisma, args as any)).toBe(false);
        expect(state.stock).toEqual({ p1: 5, p2: 1 });
    });

    it('is tenant scoped', async () => {
        const { prisma, state } = fake([order()], { p1: 3, p2: 0 });
        expect(await cancelOrderAndRestock(prisma, { tenantId: 'other', orderId: 'o1', items: order().items, guard: {} } as any)).toBe(false);
        expect(state.stock).toEqual({ p1: 3, p2: 0 });
    });
});
