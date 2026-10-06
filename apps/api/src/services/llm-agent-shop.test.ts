/**
 * The assistant for PRODUCT tenants: product/order tools and a shop-specific
 * prompt, and SERVICE tenants left exactly as they were.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
    default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));

const createPaymentLink = vi.fn();
vi.mock('./payment-link.js', () => ({ createPaymentLink: (...a: unknown[]) => createPaymentLink(...a) }));
const createOrderAtomic = vi.fn();
vi.mock('./order-create.js', async (orig) => ({
    ...(await orig<typeof import('./order-create.js')>()),
    createOrderAtomic: (...a: unknown[]) => createOrderAtomic(...a),
}));
const createNotification = vi.fn(async () => undefined);
vi.mock('./notifications.js', () => ({ createNotification: (...a: unknown[]) => (createNotification as any)(...a) }));
vi.mock('./customer-memory.js', () => ({ buildCustomerMemory: async () => ({ summary: '', isReturning: false }) }));

import { runAgent, type AgentContext } from './llm-agent.js';
import { OrderError } from './order-create.js';

process.env.OPENAI_API_KEY = 'test';

function makePrisma(over: Record<string, any> = {}) {
    return {
        message: { findMany: vi.fn(async () => []) },
        service: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
        workingHours: { findMany: vi.fn(async () => []) },
        product: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
        order: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
        booking: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
        conversation: {
            update: vi.fn(async () => ({})),
            findFirst: vi.fn(async () => ({ botContext: null, contextVersion: 0 })),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        ...over,
    } as any;
}

function ctxFor(businessType: 'SERVICE' | 'PRODUCT', prisma: any, over: Partial<AgentContext> = {}): AgentContext {
    return {
        prisma, tenantId: 't1', tenantName: 'Kofi Shoes', timezone: 'Africa/Accra', currency: 'GHS',
        paystackSecretKeyEncrypted: null, businessType, depositRequired: true, defaultDepositAmount: 10,
        conversationId: 'c1', customerPhone: '+233241234567', channel: 'WHATSAPP', ...over,
    };
}

/** Script the model: one assistant turn of tool calls, then a final text. Returns the tool results it saw. */
function script(calls: Array<{ name: string; args: Record<string, unknown> }>) {
    const toolMessages: any[] = [];
    create.mockReset();
    create
        .mockImplementationOnce(async () => ({
            choices: [{ message: {
                role: 'assistant', content: null,
                tool_calls: calls.map((c, i) => ({ id: `call${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
            } }],
        }))
        .mockImplementationOnce(async (req: any) => {
            toolMessages.push(...req.messages.filter((m: any) => m.role === 'tool'));
            return { choices: [{ message: { role: 'assistant', content: 'done' } }] };
        });
    return toolMessages;
}
const parsed = (m: any) => JSON.parse(m.content);

async function firstRequest(ctx: AgentContext) {
    create.mockReset();
    create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'hi' } }] });
    await runAgent(ctx, 'hello');
    return create.mock.calls[0][0] as { tools: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: string }> };
}

beforeEach(() => {
    create.mockReset(); createPaymentLink.mockReset(); createOrderAtomic.mockReset(); createNotification.mockClear();
});

describe('tool sets by business type', () => {
    it('PRODUCT gets shop tools and none of the appointment tools', async () => {
        const req = await firstRequest(ctxFor('PRODUCT', makePrisma()));
        const names = req.tools.map((t) => t.function.name).sort();
        expect(names).toEqual([
            'create_order', 'get_order_payment_link', 'get_order_status', 'get_product', 'list_products', 'request_human', 'save_customer_phone',
        ]);
    });

    it('SERVICE tenants keep exactly the appointment tools and no shop tools', async () => {
        const req = await firstRequest(ctxFor('SERVICE', makePrisma()));
        const names = req.tools.map((t) => t.function.name).sort();
        expect(names).toEqual([
            'check_availability', 'create_booking', 'get_my_bookings', 'get_payment_link', 'list_services', 'request_human', 'save_customer_phone',
        ]);
    });
});

describe('system prompt by business type', () => {
    it('PRODUCT prompt has no deposit / appointment / booking talk and points at the product tools', async () => {
        const req = await firstRequest(ctxFor('PRODUCT', makePrisma()));
        const prompt = req.messages[0].content;
        expect(prompt).toContain('Kofi Shoes');
        expect(prompt).toContain('list_products');
        expect(prompt).toContain('create_order');
        expect(prompt).not.toMatch(/deposit|appointment|booking|\bbook\b|slot|check_availability|create_booking/i);
    });

    it('SERVICE prompt is unchanged: deposits, availability and booking rules', async () => {
        const req = await firstRequest(ctxFor('SERVICE', makePrisma()));
        const prompt = req.messages[0].content;
        expect(prompt).toContain('Deposits and booking status');
        expect(prompt).toContain('check_availability');
        expect(prompt).not.toContain('list_products');
    });
});

describe('tools are gated by business type at execution, not only by what is offered', () => {
    it('a PRODUCT tenant cannot run create_booking even if the model asks', async () => {
        const prisma = makePrisma();
        const seen = script([{ name: 'create_booking', args: { serviceId: 's', date: '2030-01-01', time: '10:00', customerName: 'A' } }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'book me');
        expect(parsed(seen[0]).error).toMatch(/unknown tool|not available/i);
        expect(prisma.service.findFirst).not.toHaveBeenCalled();
    });

    it('a SERVICE tenant cannot run create_order or list_products', async () => {
        const prisma = makePrisma();
        const seen = script([{ name: 'list_products', args: {} }, { name: 'create_order', args: { items: [{ productId: 'p', quantity: 1 }], customerName: 'A' } }]);
        await runAgent(ctxFor('SERVICE', prisma), 'x');
        expect(seen.map((m) => parsed(m).error)).toEqual([expect.stringMatching(/unknown tool|not available/i), expect.stringMatching(/unknown tool|not available/i)]);
        expect(prisma.product.findMany).not.toHaveBeenCalled();
        expect(createOrderAtomic).not.toHaveBeenCalled();
    });
});

describe('list_products / get_product', () => {
    it('lists active products of THIS tenant with price and stock', async () => {
        const prisma = makePrisma();
        prisma.product.findMany.mockResolvedValue([
            { id: 'p1', name: 'Red Shoe', description: 'Leather', price: 120, stock: 4, category: 'Shoes' },
            { id: 'p2', name: 'Blue Shoe', description: null, price: 99.5, stock: 0, category: 'Shoes' },
        ]);
        const seen = script([{ name: 'list_products', args: { query: 'shoe' } }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'shoes?');
        const where = prisma.product.findMany.mock.calls[0][0].where;
        expect(where.tenantId).toBe('t1');
        expect(where.isActive).toBe(true);
        expect(JSON.stringify(where)).toContain('shoe');
        const out = parsed(seen[0]);
        expect(out.products[0]).toMatchObject({ id: 'p1', name: 'Red Shoe', price: '120', inStock: true, stock: 4 });
        expect(out.products[1]).toMatchObject({ id: 'p2', inStock: false, stock: 0 });
    });

    it('caps the result size and ignores an absurd limit', async () => {
        const prisma = makePrisma();
        script([{ name: 'list_products', args: { limit: 100000 } }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'all');
        expect(prisma.product.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(20);
    });

    it('get_product is tenant-scoped and reports unknown ids', async () => {
        const prisma = makePrisma();
        const seen = script([{ name: 'get_product', args: { productId: 'other-tenants-product' } }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'x');
        expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'other-tenants-product', tenantId: 't1', isActive: true });
        expect(parsed(seen[0]).error).toMatch(/not found/i);
    });
});

describe('create_order', () => {
    const orderRow = {
        id: 'o1', orderRef: 'ORD-AAAA1111', totalAmount: 240, status: 'PENDING', paymentStatus: 'UNPAID',
        items: [{ quantity: 2, unitPrice: 120, product: { name: 'Red Shoe' } }],
    };
    const args = { items: [{ productId: 'p1', quantity: 2 }], customerName: 'Ama', deliveryAddress: '12 Oak St' };

    it('places the order for this tenant and phone, then returns a payment link', async () => {
        const prisma = makePrisma();
        createOrderAtomic.mockResolvedValue(orderRow);
        createPaymentLink.mockResolvedValue('https://pay.example/abc');
        const seen = script([{ name: 'create_order', args }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'order');
        expect(createOrderAtomic).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', customerPhone: '+233241234567', customerName: 'Ama', currency: 'GHS',
            items: [{ productId: 'p1', quantity: 2 }], deliveryAddress: '12 Oak St',
        }));
        expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
            entity: 'order', id: 'o1', amount: 240, tenantId: 't1', customerPhone: '+233241234567',
        }));
        const out = parsed(seen[0]);
        expect(out).toMatchObject({ reference: 'ORD-AAAA1111', total: 'GHS 240.00', payUrl: 'https://pay.example/abc', status: 'PENDING' });
        expect(out.items).toEqual([{ name: 'Red Shoe', quantity: 2, unitPrice: 'GHS 120.00' }]);
        expect(createNotification).toHaveBeenCalledWith(prisma, expect.objectContaining({ tenantId: 't1', type: 'SYSTEM' }), undefined);
    });

    it('tells the model when an item is short and what is left', async () => {
        createOrderAtomic.mockRejectedValue(new OrderError('OUT_OF_STOCK', 'x', { productName: 'Red Shoe', available: 1 }));
        const seen = script([{ name: 'create_order', args }]);
        await runAgent(ctxFor('PRODUCT', makePrisma()), 'order');
        expect(parsed(seen[0]).error).toMatch(/Red Shoe/);
        expect(parsed(seen[0]).error).toMatch(/1/);
        expect(createPaymentLink).not.toHaveBeenCalled();
    });

    it('maps unknown products and bad quantities to model-readable errors (not throws)', async () => {
        createOrderAtomic.mockRejectedValueOnce(new OrderError('UNKNOWN_PRODUCT', 'x'));
        const seen = script([{ name: 'create_order', args }]);
        await runAgent(ctxFor('PRODUCT', makePrisma()), 'order');
        expect(parsed(seen[0]).error).toMatch(/list_products/);
    });

    it('rethrows unexpected errors so the turn retries instead of replying wrongly', async () => {
        createOrderAtomic.mockRejectedValue(new Error('db down'));
        script([{ name: 'create_order', args }]);
        await expect(runAgent(ctxFor('PRODUCT', makePrisma()), 'order')).rejects.toThrow('db down');
    });

    it('asks for a phone first when the channel gave none, and creates nothing', async () => {
        const seen = script([{ name: 'create_order', args }]);
        await runAgent(ctxFor('PRODUCT', makePrisma(), { customerPhone: '', channel: 'INSTAGRAM' }), 'order');
        expect(parsed(seen[0]).error).toMatch(/save_customer_phone/);
        expect(createOrderAtomic).not.toHaveBeenCalled();
    });

    it('rejects a malformed items argument without touching the database', async () => {
        const seen = script([{ name: 'create_order', args: { items: 'two shoes', customerName: 'Ama' } }]);
        await runAgent(ctxFor('PRODUCT', makePrisma()), 'order');
        expect(parsed(seen[0]).error).toMatch(/items/i);
        expect(createOrderAtomic).not.toHaveBeenCalled();
    });

    it('keeps the order and says so when no payment link can be made, and tells the owner', async () => {
        createOrderAtomic.mockResolvedValue(orderRow);
        createPaymentLink.mockResolvedValue(null);
        const seen = script([{ name: 'create_order', args }]);
        await runAgent(ctxFor('PRODUCT', makePrisma()), 'order');
        const out = parsed(seen[0]);
        expect(out.reference).toBe('ORD-AAAA1111');
        expect(out.payUrl).toBeUndefined();
        expect(out.note).toMatch(/team/i);
        expect(createNotification).toHaveBeenCalledTimes(2); // new order + payment link unavailable
    });

    it('does not place the same order twice when the model repeats the call', async () => {
        const prisma = makePrisma();
        prisma.order.findMany.mockResolvedValue([{
            ...orderRow, paymentAuthorizationUrl: 'https://pay.example/existing',
            items: [{ productId: 'p1', quantity: 2, unitPrice: 120, product: { name: 'Red Shoe' } }],
        }]);
        const seen = script([{ name: 'create_order', args }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'order');
        expect(createOrderAtomic).not.toHaveBeenCalled();
        expect(parsed(seen[0])).toMatchObject({ reference: 'ORD-AAAA1111', payUrl: 'https://pay.example/existing', alreadyPlaced: true });
        const where = prisma.order.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ tenantId: 't1', customerPhone: '+233241234567' });
    });
});

describe('get_order_status', () => {
    it('only shows this customer\'s orders for this tenant', async () => {
        const prisma = makePrisma();
        prisma.order.findMany.mockResolvedValue([{
            orderRef: 'ORD-1', status: 'SHIPPED', paymentStatus: 'PAID', totalAmount: 50, createdAt: new Date('2026-10-01T10:00:00Z'),
            publicToken: 'tok', items: [{ quantity: 1, product: { name: 'Hat' } }],
        }]);
        const seen = script([{ name: 'get_order_status', args: { reference: 'ORD-1' } }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'where is my order');
        expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', customerPhone: '+233241234567', orderRef: 'ORD-1' });
        const out = parsed(seen[0]);
        expect(out.orders[0]).toMatchObject({ reference: 'ORD-1', status: 'SHIPPED', payment: 'PAID', total: 'GHS 50.00' });
        expect(out.orders[0].items).toEqual([{ name: 'Hat', quantity: 1 }]);
    });

    it('says so when there is nothing, and refuses with no phone on file', async () => {
        const seen = script([{ name: 'get_order_status', args: {} }]);
        await runAgent(ctxFor('PRODUCT', makePrisma()), 'x');
        expect(parsed(seen[0]).error).toMatch(/no orders/i);

        const prisma = makePrisma();
        const seen2 = script([{ name: 'get_order_status', args: {} }]);
        await runAgent(ctxFor('PRODUCT', prisma, { customerPhone: '' }), 'x');
        // No verified phone and nothing made in this chat: nothing to show, and it must not ask for a number to look one up.
        expect(parsed(seen2[0]).error).toMatch(/no orders/i);
        expect(prisma.order.findMany).not.toHaveBeenCalled();
    });
});

describe('get_order_payment_link', () => {
    const unpaid = { id: 'o1', orderRef: 'ORD-1', totalAmount: 240, paymentAuthorizationUrl: null };

    it('reuses an existing link', async () => {
        const prisma = makePrisma();
        prisma.order.findFirst.mockResolvedValue({ ...unpaid, paymentAuthorizationUrl: 'https://pay.example/old' });
        const seen = script([{ name: 'get_order_payment_link', args: {} }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'link?');
        expect(createPaymentLink).not.toHaveBeenCalled();
        expect(parsed(seen[0])).toMatchObject({ reference: 'ORD-1', payUrl: 'https://pay.example/old', amount: 'GHS 240.00' });
        expect(prisma.order.findFirst.mock.calls[0][0].where).toMatchObject({
            tenantId: 't1', customerPhone: '+233241234567', paymentStatus: 'UNPAID', status: { not: 'CANCELLED' },
        });
    });

    it('creates one via the payment-link service when none exists', async () => {
        const prisma = makePrisma();
        prisma.order.findFirst.mockResolvedValue(unpaid);
        createPaymentLink.mockResolvedValue('https://pay.example/new');
        const seen = script([{ name: 'get_order_payment_link', args: { reference: 'ORD-1' } }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'link?');
        expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ entity: 'order', id: 'o1', amount: 240, tenantId: 't1' }));
        expect(parsed(seen[0]).payUrl).toBe('https://pay.example/new');
    });

    it('reports nothing to pay, and a failed link, without inventing a URL', async () => {
        const seen = script([{ name: 'get_order_payment_link', args: {} }]);
        await runAgent(ctxFor('PRODUCT', makePrisma()), 'x');
        expect(parsed(seen[0]).error).toMatch(/no unpaid order/i);

        const prisma = makePrisma();
        prisma.order.findFirst.mockResolvedValue(unpaid);
        createPaymentLink.mockResolvedValue(null);
        const seen2 = script([{ name: 'get_order_payment_link', args: {} }]);
        await runAgent(ctxFor('PRODUCT', prisma), 'x');
        expect(parsed(seen2[0]).error).toMatch(/team will send/i);
        expect(parsed(seen2[0]).payUrl).toBeUndefined();
    });
});
