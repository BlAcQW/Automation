import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveCustomerIdSafe = vi.fn(async () => 'cust-1');
vi.mock('./customers.js', () => ({ resolveCustomerIdSafe: (...a: unknown[]) => (resolveCustomerIdSafe as any)(...a) }));
const emitOrderCreated = vi.fn(async () => undefined);
vi.mock('./events/emit.js', () => ({ emitOrderCreated: (...a: unknown[]) => (emitOrderCreated as any)(...a) }));

import { createOrderAtomic, OrderError, MAX_LINE_QUANTITY, DASHBOARD_MAX_LINE_QUANTITY } from './order-create.js';

type P = { id: string; tenantId: string; name: string; price: number; stock: number; isActive: boolean };

/** In-memory prisma: updateMany honours where + gte atomically; $transaction rolls back on throw. */
function fakePrisma(products: P[]) {
    const state = { products: products.map((p) => ({ ...p })), orders: [] as any[] };
    const matches = (p: P, w: any) =>
        (w.id === undefined || p.id === w.id) &&
        (w.tenantId === undefined || p.tenantId === w.tenantId) &&
        (w.isActive === undefined || p.isActive === w.isActive) &&
        (w.stock?.gte === undefined || p.stock >= w.stock.gte) &&
        (w.id?.in === undefined || w.id.in.includes(p.id));
    const calls: any[] = [];
    const tx = {
        product: {
            findMany: vi.fn(async ({ where }: any) => {
                calls.push({ op: 'findMany', where });
                return state.products.filter((p) => {
                    const idOk = where.id?.in ? where.id.in.includes(p.id) : true;
                    return idOk && p.tenantId === where.tenantId && (where.isActive === undefined || p.isActive === where.isActive);
                }).map((p) => ({ ...p }));
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                calls.push({ op: 'updateMany', where });
                const hit = state.products.filter((p) => matches(p, where));
                for (const p of hit) p.stock -= data.stock.decrement;
                return { count: hit.length };
            }),
        },
        order: {
            create: vi.fn(async ({ data }: any) => {
                const o = { id: `o${state.orders.length + 1}`, ...data, items: data.items.create.map((i: any) => ({ ...i })) };
                state.orders.push(o);
                return o;
            }),
        },
    };
    // Transactions run one at a time, like row locks on the same product would force.
    let lock: Promise<unknown> = Promise.resolve();
    const prisma = {
        tenant: { findUnique: async () => ({ paymentCurrency: 'GHS' }) },
        $transaction: (fn: any) => {
            const run = async () => {
                const snap = JSON.parse(JSON.stringify(state));
                try {
                    return await fn(tx);
                } catch (e) {
                    state.products = snap.products;
                    state.orders = snap.orders;
                    throw e;
                }
            };
            const result = lock.then(run, run);
            lock = result.catch(() => undefined);
            return result;
        },
    };
    return { prisma: prisma as any, state, calls };
}

const base = { tenantId: 't1', customerName: 'Ama', customerPhone: '+233241234567', currency: 'GHS' };
const shoe: P = { id: 'p1', tenantId: 't1', name: 'Shoe', price: 10, stock: 5, isActive: true };

beforeEach(() => { resolveCustomerIdSafe.mockClear(); emitOrderCreated.mockClear(); });

describe('createOrderAtomic', () => {
    it('creates the order, totals it, decrements stock, links the customer, emits order.created', async () => {
        const { prisma, state } = fakePrisma([shoe]);
        const order = await createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 2 }] });
        expect(Number(order.totalAmount)).toBe(20);
        expect(order.tenantId).toBe('t1');
        expect(order.customerId).toBe('cust-1');
        expect(order.orderRef).toMatch(/^ORD-[A-Z0-9_-]{8}$/);
        expect(order.publicToken).toBeTruthy();
        expect(state.products[0].stock).toBe(3);
        expect(emitOrderCreated).toHaveBeenCalledWith(prisma, expect.objectContaining({ tenantId: 't1', total: 20, currency: 'GHS', customerId: 'cust-1' }));
    });

    it('computes totals exactly (3 x 0.10 is 0.30, not 0.30000000000000004)', async () => {
        const { prisma } = fakePrisma([{ ...shoe, price: 0.1 }]);
        const order = await createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 3 }] });
        expect(order.totalAmount).toBe(0.3);
    });

    it('merges duplicate lines for one product into a single line', async () => {
        const { prisma, state } = fakePrisma([shoe]);
        const order = await createOrderAtomic({
            prisma, ...base, items: [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 1 }],
        });
        expect(order.items).toHaveLength(1);
        expect(order.items[0].quantity).toBe(3);
        expect(state.products[0].stock).toBe(2);
    });

    it('rejects when stock is short, and writes nothing', async () => {
        const { prisma, state } = fakePrisma([{ ...shoe, stock: 1 }]);
        await expect(createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 2 }] }))
            .rejects.toMatchObject({ code: 'OUT_OF_STOCK', productName: 'Shoe', available: 1 });
        expect(state.orders).toHaveLength(0);
        expect(state.products[0].stock).toBe(1);
        expect(emitOrderCreated).not.toHaveBeenCalled();
    });

    it('a multi-line order is all-or-nothing: line 2 short rolls back line 1', async () => {
        const hat: P = { id: 'p2', tenantId: 't1', name: 'Hat', price: 5, stock: 0, isActive: true };
        const { prisma, state } = fakePrisma([shoe, hat]);
        await expect(createOrderAtomic({
            prisma, ...base, items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 1 }],
        })).rejects.toBeInstanceOf(OrderError);
        expect(state.products.find((p) => p.id === 'p1')!.stock).toBe(5);
        expect(state.orders).toHaveLength(0);
    });

    it('stock never goes negative when two orders race for the last unit', async () => {
        const { prisma, state } = fakePrisma([{ ...shoe, stock: 1 }]);
        const results = await Promise.allSettled([
            createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 1 }] }),
            createOrderAtomic({ prisma, ...base, customerName: 'Kofi', items: [{ productId: 'p1', quantity: 1 }] }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(state.products[0].stock).toBe(0);
        expect(state.orders).toHaveLength(1);
    });

    it('the stock decrement is guarded by stock >= quantity, tenant and isActive (not read-then-write)', async () => {
        const { prisma, calls } = fakePrisma([shoe]);
        await createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 2 }] });
        const dec = calls.find((c) => c.op === 'updateMany')!;
        expect(dec.where).toEqual({ id: 'p1', tenantId: 't1', isActive: true, stock: { gte: 2 } });
    });

    it('does not see another tenant\'s product', async () => {
        const { prisma } = fakePrisma([{ ...shoe, tenantId: 'other' }]);
        await expect(createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 1 }] }))
            .rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' });
    });

    it('rejects an inactive product', async () => {
        const { prisma } = fakePrisma([{ ...shoe, isActive: false }]);
        await expect(createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 1 }] }))
            .rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' });
    });

    it.each([0, -1, 1.5, Number.NaN, MAX_LINE_QUANTITY + 1])('rejects invalid quantity %s', async (quantity) => {
        const { prisma } = fakePrisma([shoe]);
        await expect(createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity }] }))
            .rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it('rejects an empty order', async () => {
        const { prisma } = fakePrisma([shoe]);
        await expect(createOrderAtomic({ prisma, ...base, items: [] })).rejects.toMatchObject({ code: 'NO_ITEMS' });
    });

    it('rejects a missing customer phone (an order needs somewhere to send the link)', async () => {
        const { prisma } = fakePrisma([shoe]);
        await expect(createOrderAtomic({ prisma, ...base, customerPhone: '', items: [{ productId: 'p1', quantity: 1 }] }))
            .rejects.toMatchObject({ code: 'NO_PHONE' });
    });

    it('still creates the order when the customer link or the event fails', async () => {
        resolveCustomerIdSafe.mockResolvedValueOnce(null as any);
        emitOrderCreated.mockRejectedValueOnce(new Error('events down'));
        const { prisma, state } = fakePrisma([shoe]);
        const order = await createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 1 }] });
        expect(order.customerId).toBeNull();
        expect(state.orders).toHaveLength(1);
    });

    it('linkCustomer:false (a typed, unverified phone) never touches customer records', async () => {
        const { prisma } = fakePrisma([shoe]);
        const order = await createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 1 }], linkCustomer: false });
        expect(resolveCustomerIdSafe).not.toHaveBeenCalled();
        expect(order.customerId).toBeNull();
    });

    describe('line quantity cap is a parameter', () => {
        const big: P = { ...shoe, stock: 50_000 };

        it('the chat default stays 100 per product', async () => {
            const { prisma } = fakePrisma([big]);
            await expect(createOrderAtomic({ prisma, ...base, items: [{ productId: 'p1', quantity: 101 }] }))
                .rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
        });

        it('the dashboard cap lets a wholesale quantity through and decrements that much stock', async () => {
            const { prisma, state } = fakePrisma([big]);
            const order = await createOrderAtomic({
                prisma, ...base, maxLineQuantity: DASHBOARD_MAX_LINE_QUANTITY, items: [{ productId: 'p1', quantity: 5_000 }],
            });
            expect(order.items[0].quantity).toBe(5_000);
            expect(state.products[0].stock).toBe(45_000);
        });

        it('still refuses above the dashboard cap, and the message names the cap in use', async () => {
            const { prisma } = fakePrisma([big]);
            await expect(createOrderAtomic({
                prisma, ...base, maxLineQuantity: DASHBOARD_MAX_LINE_QUANTITY,
                items: [{ productId: 'p1', quantity: DASHBOARD_MAX_LINE_QUANTITY + 1 }],
            })).rejects.toThrow(String(DASHBOARD_MAX_LINE_QUANTITY));
        });

        it('applies the cap to the merged total of duplicate lines', async () => {
            const { prisma } = fakePrisma([big]);
            await expect(createOrderAtomic({
                prisma, ...base, maxLineQuantity: 100, items: [{ productId: 'p1', quantity: 60 }, { productId: 'p1', quantity: 60 }],
            })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
        });
    });
});
