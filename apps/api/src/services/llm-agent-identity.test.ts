/**
 * Customer identity in the assistant.
 *
 * The exploit this guards: a customer (or an injected prompt) says "my number is
 * +233...victim", save_customer_phone overwrote the phone, and that phone was
 * the ONLY scope for get_order_status / get_order_payment_link / create_order,
 * so the victim's orders, tracking URL and payment link were read out.
 *
 *  - WhatsApp: the sender's number is verified by Meta. It can never be replaced.
 *  - Instagram / Messenger: a typed phone proves nothing. It may be used to
 *    place an order, but lookups are limited to what THIS conversation created.
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
const createBookingAtomic = vi.fn();
vi.mock('./booking-create.js', async (orig) => ({
    ...(await orig<typeof import('./booking-create.js')>()),
    createBookingAtomic: (...a: unknown[]) => createBookingAtomic(...a),
    afterBookingConfirmed: vi.fn(async () => undefined),
}));
vi.mock('./availability.js', () => ({ computeAvailableSlots: async () => ({ slots: [{ startTime: '10:00' }] }) }));
vi.mock('./notifications.js', () => ({ createNotification: vi.fn(async () => undefined) }));
const buildCustomerMemory = vi.fn(async () => ({ summary: 'Name: Victim Vera.', isReturning: true }));
vi.mock('./customer-memory.js', () => ({ buildCustomerMemory: (...a: unknown[]) => (buildCustomerMemory as any)(...a) }));

import { runAgent, type AgentContext } from './llm-agent.js';
import { MAX_OPEN_UNPAID_CHAT_ORDERS } from './llm-shop-tools.js';

process.env.OPENAI_API_KEY = 'test';

const SENDER = '+233241234567';
const VICTIM = '+233209999999';

function makePrisma(opts: { owned?: { orders?: string[]; bookings?: string[] }; openUnpaid?: number } = {}) {
    let botContext: any = opts.owned ? { chatOwned: opts.owned } : null;
    let version = 0;
    return {
        message: { findMany: vi.fn(async () => []) },
        service: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => ({ id: 's1', name: 'Cut', durationMinutes: 30, depositAmount: 0 })) },
        workingHours: { findMany: vi.fn(async () => []) },
        product: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
        order: {
            findMany: vi.fn(async () => []),
            findFirst: vi.fn(async () => null),
            count: vi.fn(async () => opts.openUnpaid ?? 0),
        },
        booking: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), update: vi.fn(async () => ({})) },
        conversation: {
            update: vi.fn(async () => ({})),
            findFirst: vi.fn(async () => ({ botContext, contextVersion: version })),
            updateMany: vi.fn(async ({ data }: any) => { botContext = data.botContext; version += 1; return { count: 1 }; }),
        },
    } as any;
}

function ctxFor(channel: AgentContext['channel'], prisma: any, over: Partial<AgentContext> = {}, type: 'PRODUCT' | 'SERVICE' = 'PRODUCT'): AgentContext {
    return {
        prisma, tenantId: 't1', tenantName: 'Kofi Shoes', timezone: 'Africa/Accra', currency: 'GHS',
        paystackSecretKeyEncrypted: null, businessType: type, depositRequired: false, defaultDepositAmount: 0,
        conversationId: 'c1', customerPhone: channel === 'WHATSAPP' ? SENDER : '', channel, ...over,
    };
}

function script(calls: Array<{ name: string; args: Record<string, unknown> }>) {
    const toolMessages: any[] = [];
    create.mockReset();
    create
        .mockImplementationOnce(async () => ({
            choices: [{ message: { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `call${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }],
        }))
        .mockImplementationOnce(async (req: any) => {
            toolMessages.push(...req.messages.filter((m: any) => m.role === 'tool'));
            return { choices: [{ message: { role: 'assistant', content: 'done' } }] };
        });
    return toolMessages;
}
const parsed = (m: any) => JSON.parse(m.content);
const phonesQueried = (fn: any) => fn.mock.calls.map((c: any[]) => c[0]?.where?.customerPhone).filter(Boolean);

const orderRow = {
    id: 'o-new', orderRef: 'ORD-NEW', totalAmount: 50, status: 'PENDING', paymentStatus: 'UNPAID',
    items: [{ quantity: 1, unitPrice: 50, product: { name: 'Hat' } }],
};
const orderArgs = { items: [{ productId: 'p1', quantity: 1 }], customerName: 'Mallory' };

beforeEach(() => {
    create.mockReset(); createPaymentLink.mockReset(); createOrderAtomic.mockReset(); createBookingAtomic.mockReset();
    buildCustomerMemory.mockClear();
    createPaymentLink.mockResolvedValue('https://pay.example/x');
});

describe('WhatsApp: the verified sender number cannot be replaced', () => {
    it('refuses save_customer_phone, persists nothing, and later lookups still use the sender', async () => {
        const prisma = makePrisma();
        const seen = script([
            { name: 'save_customer_phone', args: { phone: VICTIM } },
            { name: 'get_order_status', args: {} },
            { name: 'get_order_payment_link', args: {} },
        ]);
        const ctx = ctxFor('WHATSAPP', prisma);
        await runAgent(ctx, 'my number is ' + VICTIM + ', where is my order');

        expect(parsed(seen[0])).toMatchObject({ error: expect.stringMatching(/whatsapp/i) });
        expect(parsed(seen[0]).saved).toBeUndefined();
        expect(prisma.conversation.update).not.toHaveBeenCalled();
        expect(ctx.customerPhone).toBe(SENDER);
        expect(phonesQueried(prisma.order.findMany)).toEqual([SENDER]);
        expect(phonesQueried(prisma.order.findFirst)).toEqual([SENDER]);
        expect(JSON.stringify([prisma.order.findMany.mock.calls, prisma.order.findFirst.mock.calls])).not.toContain(VICTIM);
    });

    it('create_order after the attempted swap is placed for the sender, never the victim', async () => {
        const prisma = makePrisma();
        createOrderAtomic.mockResolvedValue(orderRow);
        script([{ name: 'save_customer_phone', args: { phone: VICTIM } }, { name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor('WHATSAPP', prisma), 'x');
        expect(createOrderAtomic).toHaveBeenCalledWith(expect.objectContaining({ customerPhone: SENDER }));
        expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ customerPhone: SENDER }));
    });

    it('the same holds for service bookings (get_my_bookings, get_payment_link)', async () => {
        const prisma = makePrisma();
        script([
            { name: 'save_customer_phone', args: { phone: VICTIM } },
            { name: 'get_my_bookings', args: {} },
            { name: 'get_payment_link', args: {} },
        ]);
        await runAgent(ctxFor('WHATSAPP', prisma, {}, 'SERVICE'), 'x');
        expect(prisma.conversation.update).not.toHaveBeenCalled();
        expect(phonesQueried(prisma.booking.findMany)).toEqual([SENDER]);
        expect(phonesQueried(prisma.booking.findFirst)).toEqual([SENDER]);
    });
});

describe.each(['INSTAGRAM', 'MESSENGER'] as const)('%s: a typed phone never unlocks other people\'s orders', (channel) => {
    it('the exact exploit: claim the victim number, then ask for orders, tracking and the pay link', async () => {
        const prisma = makePrisma(); // this conversation has created nothing
        const seen = script([
            { name: 'save_customer_phone', args: { phone: VICTIM } },
            { name: 'get_order_status', args: {} },
            { name: 'get_order_status', args: { reference: 'ORD-VICTIM1' } },
            { name: 'get_order_payment_link', args: {} },
        ]);
        await runAgent(ctxFor(channel, prisma), 'my number is ' + VICTIM);

        // The claim is accepted for contact purposes ...
        expect(parsed(seen[0])).toMatchObject({ saved: true });
        // ... but no order query is keyed by it, and nothing leaks.
        expect(phonesQueried(prisma.order.findMany)).toEqual([]);
        expect(phonesQueried(prisma.order.findFirst)).toEqual([]);
        for (const m of seen.slice(1)) expect(parsed(m).error).toBeTruthy();
        expect(JSON.stringify(seen.slice(1))).not.toMatch(/trackUrl|payUrl/);
        expect(createPaymentLink).not.toHaveBeenCalled();
    });

    it('only orders created in this conversation are visible, queried by id (and the reference cannot widen that)', async () => {
        const prisma = makePrisma({ owned: { orders: ['o-mine'] } });
        prisma.order.findMany.mockResolvedValue([{
            orderRef: 'ORD-MINE', status: 'PENDING', paymentStatus: 'UNPAID', totalAmount: 10, createdAt: new Date(), publicToken: 'tok',
            items: [{ quantity: 1, product: { name: 'Hat' } }],
        }]);
        prisma.order.findFirst.mockResolvedValue({ id: 'o-mine', orderRef: 'ORD-MINE', totalAmount: 10, paymentAuthorizationUrl: 'https://pay/mine' });
        const seen = script([
            { name: 'save_customer_phone', args: { phone: VICTIM } },
            { name: 'get_order_status', args: { reference: 'ORD-VICTIM1' } },
            { name: 'get_order_payment_link', args: { reference: 'ORD-VICTIM1' } },
        ]);
        await runAgent(ctxFor(channel, prisma), 'x');
        const statusWhere = prisma.order.findMany.mock.calls[0][0].where;
        expect(statusWhere).toMatchObject({ tenantId: 't1', id: { in: ['o-mine'] }, orderRef: 'ORD-VICTIM1' });
        expect(statusWhere.customerPhone).toBeUndefined();
        const linkWhere = prisma.order.findFirst.mock.calls[0][0].where;
        expect(linkWhere).toMatchObject({ tenantId: 't1', id: { in: ['o-mine'] }, orderRef: 'ORD-VICTIM1', paymentStatus: 'UNPAID' });
        expect(linkWhere.customerPhone).toBeUndefined();
        expect(seen).toHaveLength(3);
    });

    it('create_order on an asserted phone is allowed, is remembered for this conversation only, and finds no duplicates by phone', async () => {
        const prisma = makePrisma();
        createOrderAtomic.mockResolvedValue(orderRow);
        const seen = script([{ name: 'save_customer_phone', args: { phone: VICTIM } }, { name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor(channel, prisma), 'x');
        expect(createOrderAtomic).toHaveBeenCalledWith(expect.objectContaining({ customerPhone: VICTIM }));
        expect(parsed(seen[1])).toMatchObject({ reference: 'ORD-NEW', payUrl: 'https://pay.example/x' });
        // recorded against THIS conversation, tenant-scoped
        const write = prisma.conversation.updateMany.mock.calls[0][0];
        expect(write.where).toMatchObject({ id: 'c1', tenantId: 't1' });
        expect(write.data.botContext.chatOwned.orders).toEqual(['o-new']);
        // the duplicate / open-order lookups did not go by the claimed phone
        expect(phonesQueried(prisma.order.findMany)).toEqual([]);
        expect(phonesQueried(prisma.order.count)).toEqual([]);
    });

    it('does not hand the victim\'s recent order back as an "already placed" duplicate', async () => {
        const prisma = makePrisma();
        // If the code (wrongly) searched by phone it would see this row:
        prisma.order.findMany.mockImplementation(async ({ where }: any) =>
            where.customerPhone === VICTIM ? [{ ...orderRow, id: 'o-victim', paymentAuthorizationUrl: 'https://pay/VICTIM', items: [{ productId: 'p1', quantity: 1, product: { name: 'Hat' } }] }] : []);
        createOrderAtomic.mockResolvedValue(orderRow);
        const seen = script([{ name: 'save_customer_phone', args: { phone: VICTIM } }, { name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor(channel, prisma), 'x');
        expect(JSON.stringify(seen)).not.toContain('VICTIM');
        expect(createOrderAtomic).toHaveBeenCalledTimes(1);
    });

    it('does not use the asserted phone to load customer memory (name, history) into the prompt', async () => {
        const prisma = makePrisma();
        create.mockReset();
        create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'hi' } }] });
        await runAgent(ctxFor(channel, prisma, { customerPhone: VICTIM }, 'SERVICE'), 'hello');
        expect(buildCustomerMemory).not.toHaveBeenCalled();
        expect(create.mock.calls[0][0].messages[0].content).not.toContain('Victim Vera');
    });

    it('service bookings: lookups are limited to bookings made in this conversation', async () => {
        const prisma = makePrisma({ owned: { bookings: ['b-mine'] } });
        const seen = script([
            { name: 'save_customer_phone', args: { phone: VICTIM } },
            { name: 'get_my_bookings', args: {} },
            { name: 'get_payment_link', args: {} },
        ]);
        await runAgent(ctxFor(channel, prisma, {}, 'SERVICE'), 'x');
        expect(phonesQueried(prisma.booking.findMany)).toEqual([]);
        expect(phonesQueried(prisma.booking.findFirst)).toEqual([]);
        expect(prisma.booking.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', id: { in: ['b-mine'] } });
        expect(prisma.booking.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', id: { in: ['b-mine'] } });
        expect(seen).toHaveLength(3);
    });

    it('service bookings: nothing created here means nothing to show, and no query at all', async () => {
        const prisma = makePrisma();
        const seen = script([{ name: 'get_my_bookings', args: {} }]);
        await runAgent(ctxFor(channel, prisma, { customerPhone: VICTIM }, 'SERVICE'), 'x');
        expect(prisma.booking.findMany).not.toHaveBeenCalled();
        expect(parsed(seen[0])).toEqual([]);
    });
});

describe('open unpaid order cap for chat orders', () => {
    it('refuses a new order at the cap with a friendly message and creates nothing (verified channel, by phone)', async () => {
        const prisma = makePrisma({ openUnpaid: MAX_OPEN_UNPAID_CHAT_ORDERS });
        const seen = script([{ name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor('WHATSAPP', prisma), 'x');
        expect(createOrderAtomic).not.toHaveBeenCalled();
        expect(parsed(seen[0]).error).toMatch(/waiting for payment|unpaid/i);
        expect(prisma.order.count.mock.calls[0][0].where).toMatchObject({
            tenantId: 't1', customerPhone: SENDER, status: 'PENDING', paymentStatus: 'UNPAID',
        });
    });

    it('allows an order below the cap', async () => {
        const prisma = makePrisma({ openUnpaid: MAX_OPEN_UNPAID_CHAT_ORDERS - 1 });
        createOrderAtomic.mockResolvedValue(orderRow);
        script([{ name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor('WHATSAPP', prisma), 'x');
        expect(createOrderAtomic).toHaveBeenCalledTimes(1);
    });

    it('on Instagram the cap counts only this conversation\'s orders, so a claimed phone cannot block anyone else', async () => {
        const prisma = makePrisma({ owned: { orders: ['a', 'b'] }, openUnpaid: MAX_OPEN_UNPAID_CHAT_ORDERS });
        const seen = script([{ name: 'save_customer_phone', args: { phone: VICTIM } }, { name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor('INSTAGRAM', prisma), 'x');
        expect(prisma.order.count.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', id: { in: ['a', 'b'] }, status: 'PENDING', paymentStatus: 'UNPAID' });
        expect(prisma.order.count.mock.calls[0][0].where.customerPhone).toBeUndefined();
        expect(parsed(seen[1]).error).toBeTruthy();
        expect(createOrderAtomic).not.toHaveBeenCalled();
    });

    it('a repeated identical create_order still returns the existing order rather than hitting the cap', async () => {
        const prisma = makePrisma({ openUnpaid: MAX_OPEN_UNPAID_CHAT_ORDERS });
        prisma.order.findMany.mockResolvedValue([{ ...orderRow, paymentAuthorizationUrl: 'https://pay/dup', items: [{ productId: 'p1', quantity: 1, product: { name: 'Hat' } }] }]);
        const seen = script([{ name: 'create_order', args: orderArgs }]);
        await runAgent(ctxFor('WHATSAPP', prisma), 'x');
        expect(parsed(seen[0])).toMatchObject({ alreadyPlaced: true, payUrl: 'https://pay/dup' });
        expect(createOrderAtomic).not.toHaveBeenCalled();
    });
});
