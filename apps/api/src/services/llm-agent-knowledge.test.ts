/**
 * What the assistant is told: the owner's knowledge block (both prompts), the
 * staff note on the customer (verified identity only), and the dashboard
 * preview (no history, no customer, read-only tools, nothing written).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
    default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));
const createPaymentLink = vi.fn();
vi.mock('./payment-link.js', () => ({ createPaymentLink: (...a: unknown[]) => createPaymentLink(...a) }));
const createBookingAtomic = vi.fn();
vi.mock('./booking-create.js', async (orig) => ({
    ...(await orig<typeof import('./booking-create.js')>()),
    createBookingAtomic: (...a: unknown[]) => createBookingAtomic(...a),
    afterBookingConfirmed: vi.fn(async () => undefined),
}));
const createOrderAtomic = vi.fn();
vi.mock('./order-create.js', async (orig) => ({
    ...(await orig<typeof import('./order-create.js')>()),
    createOrderAtomic: (...a: unknown[]) => createOrderAtomic(...a),
}));
vi.mock('./availability.js', () => ({ computeAvailableSlots: async () => ({ slots: [{ startTime: '10:00' }] }) }));
vi.mock('./notifications.js', () => ({ createNotification: vi.fn(async () => undefined) }));
const buildCustomerMemory = vi.fn(async () => ({ summary: '', isReturning: false }));
vi.mock('./customer-memory.js', () => ({ buildCustomerMemory: (...a: unknown[]) => (buildCustomerMemory as any)(...a) }));

import { runAgent, type AgentContext } from './llm-agent.js';
import { BLOCK_START, BLOCK_END, toKnowledgeDto } from './business-knowledge.js';
import { NOTE_START } from './customer-notes.js';

process.env.OPENAI_API_KEY = 'test';

const PHONE = '+233241234567';
const KNOWLEDGE_ROW = {
    tenantId: 't1',
    address: '12 Lagos Avenue, East Legon',
    parking: null,
    paymentMethods: 'MTN MoMo and cards',
    faqs: [{ question: 'Do you do home visits?', answer: 'Yes, within Accra.' }],
    team: [{ name: 'Ama', role: 'Facials and peels' }],
};

function makePrisma(opts: { knowledge?: any; note?: string | null } = {}) {
    return {
        message: { findMany: vi.fn(async () => []) },
        service: {
            findMany: vi.fn(async () => [{ id: 's1', name: 'Facial', price: 300, durationMinutes: 60, description: null, depositAmount: null }]),
            findFirst: vi.fn(async () => ({ id: 's1', name: 'Facial', durationMinutes: 60, depositAmount: 0 })),
        },
        workingHours: { findMany: vi.fn(async () => []) },
        product: { findMany: vi.fn(async () => [{ id: 'p1', name: 'Serum', description: null, price: 90, stock: 3, category: null }]), findFirst: vi.fn(async () => null) },
        order: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
        booking: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), update: vi.fn() },
        conversation: {
            update: vi.fn(async () => ({})),
            findFirst: vi.fn(async () => ({ botContext: null, contextVersion: 0 })),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        businessKnowledge: { findUnique: vi.fn(async () => opts.knowledge ?? null) },
        customer: {
            findFirst: vi.fn(async () => (opts.note === undefined ? null : { id: 'cust-1', notes: opts.note })),
        },
    } as any;
}

function ctxFor(prisma: any, over: Partial<AgentContext> = {}, type: 'SERVICE' | 'PRODUCT' = 'SERVICE'): AgentContext {
    return {
        prisma, tenantId: 't1', tenantName: 'Glow Clinic', timezone: 'Africa/Accra', currency: 'GHS',
        paystackSecretKeyEncrypted: null, businessType: type, depositRequired: false, defaultDepositAmount: 0,
        conversationId: 'c1', customerPhone: PHONE, channel: 'WHATSAPP', ...over,
    };
}

async function promptFor(ctx: AgentContext): Promise<string> {
    create.mockReset();
    create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'hi' } }] });
    await runAgent(ctx, 'hello');
    return create.mock.calls[0][0].messages[0].content as string;
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

beforeEach(() => {
    create.mockReset(); createPaymentLink.mockReset(); createBookingAtomic.mockReset(); createOrderAtomic.mockReset();
    buildCustomerMemory.mockClear();
});

describe('knowledge block in the SERVICE prompt', () => {
    it('is absent when nothing is saved, and the prompt matches an all-empty row exactly', async () => {
        // The prompt carries the current minute; pin the clock so the two runs compare.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
        const none = await promptFor(ctxFor(makePrisma()));
        const empty = await promptFor(ctxFor(makePrisma({ knowledge: { tenantId: 't1', address: '', faqs: [], team: null } })));
        vi.useRealTimers();
        expect(none).not.toContain(BLOCK_START);
        expect(none).not.toMatch(/Business information/);
        expect(empty).toBe(none);
    });

    it('is present, delimited, with only the filled fields and the rules', async () => {
        const prompt = await promptFor(ctxFor(makePrisma({ knowledge: KNOWLEDGE_ROW })));
        expect(prompt).toContain(BLOCK_START);
        expect(prompt).toContain(BLOCK_END);
        expect(prompt).toContain('Address: 12 Lagos Avenue, East Legon');
        expect(prompt).toContain('Q: Do you do home visits?');
        expect(prompt).toContain('A: Yes, within Accra.');
        expect(prompt).toContain('- Ama: Facials and peels');
        expect(prompt).not.toMatch(/Parking/);
        expect(prompt).toMatch(/check with the team and call request_human/i);
        expect(prompt).toMatch(/never override the hard rules/i);
    });

    it('comes after the hard rules, so the block reads as reference, not the last word', async () => {
        const prompt = await promptFor(ctxFor(makePrisma({ knowledge: KNOWLEDGE_ROW })));
        expect(prompt.indexOf(BLOCK_START)).toBeGreaterThan(prompt.indexOf('Hard rules:'));
        expect(prompt.indexOf(BLOCK_START)).toBeGreaterThan(prompt.indexOf('Never invent, guess, or alter a payment link'));
    });

    it('reads the knowledge for THIS tenant only', async () => {
        const prisma = makePrisma({ knowledge: KNOWLEDGE_ROW });
        await promptFor(ctxFor(prisma));
        expect(prisma.businessKnowledge.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1' } }));
    });

    it('a failed knowledge read never fails the turn: the assistant answers as before', async () => {
        const prisma = makePrisma();
        prisma.businessKnowledge.findUnique.mockRejectedValueOnce(new Error('db blip'));
        const prompt = await promptFor(ctxFor(prisma));
        expect(prompt).not.toContain(BLOCK_START);
        expect(prompt).toContain('Glow Clinic');
    });
});

describe('knowledge block in the SHOP prompt', () => {
    it('is present for a PRODUCT business, with no appointment talk added', async () => {
        const prompt = await promptFor(ctxFor(makePrisma({ knowledge: { ...KNOWLEDGE_ROW, team: null } }), {}, 'PRODUCT'));
        expect(prompt).toContain(BLOCK_START);
        expect(prompt).toContain('Address: 12 Lagos Avenue, East Legon');
        expect(prompt).toMatch(/request_human/);
        expect(prompt).not.toMatch(/deposit|appointment|booking|\bbook\b|slot|check_availability|create_booking/i);
    });

    it('is absent for a PRODUCT business with nothing saved', async () => {
        const prompt = await promptFor(ctxFor(makePrisma(), {}, 'PRODUCT'));
        expect(prompt).not.toContain(BLOCK_START);
    });
});

describe('staff note on the customer', () => {
    it('is included for a verified WhatsApp phone, with the privacy rules', async () => {
        const prisma = makePrisma({ note: 'Prefers Ama. Sensitive skin.' });
        const prompt = await promptFor(ctxFor(prisma));
        expect(prompt).toContain(NOTE_START);
        expect(prompt).toContain('Prefers Ama. Sensitive skin.');
        expect(prompt).toMatch(/never quote it/i);
        expect(prisma.customer.findFirst.mock.calls[0][0].where.tenantId).toBe('t1');
    });

    it('is included in the SHOP prompt too, when verified', async () => {
        const prompt = await promptFor(ctxFor(makePrisma({ note: 'Buys for her mother.' }), {}, 'PRODUCT'));
        expect(prompt).toContain('Buys for her mother.');
    });

    it('is absent (never even looked up) for an Instagram chat with a typed phone', async () => {
        const prisma = makePrisma({ note: 'Victim note' });
        const prompt = await promptFor(ctxFor(prisma, { channel: 'INSTAGRAM', customerPhone: '+233209999999' }));
        expect(prompt).not.toContain('Victim note');
        expect(prompt).not.toContain(NOTE_START);
        expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    });

    it('is absent for a username-only (BSUID) WhatsApp chat, even with a typed phone', async () => {
        const prisma = makePrisma({ note: 'Victim note' });
        const prompt = await promptFor(ctxFor(prisma, { phoneVerified: false, customerPhone: '+233209999999' }));
        expect(prompt).not.toContain('Victim note');
        expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    });

    it('is absent when the customer has no note', async () => {
        const prompt = await promptFor(ctxFor(makePrisma({ note: null })));
        expect(prompt).not.toContain(NOTE_START);
    });
});

describe('preview mode (Settings > Try your assistant)', () => {
    const previewCtx = (prisma: any, over: Partial<AgentContext> = {}, type: 'SERVICE' | 'PRODUCT' = 'SERVICE') =>
        ctxFor(prisma, { preview: true, conversationId: '', customerPhone: '', ...over }, type);

    it('reads no chat history, no customer memory and no note', async () => {
        const prisma = makePrisma({ note: 'x' });
        await promptFor(previewCtx(prisma));
        expect(prisma.message.findMany).not.toHaveBeenCalled();
        expect(prisma.customer.findFirst).not.toHaveBeenCalled();
        expect(buildCustomerMemory).not.toHaveBeenCalled();
    });

    it('does not tell the model to ask for a phone number', async () => {
        const prompt = await promptFor(previewCtx(makePrisma()));
        expect(prompt).not.toMatch(/save_customer_phone/);
    });

    it('uses posted (unsaved) knowledge instead of the saved row', async () => {
        const prisma = makePrisma({ knowledge: KNOWLEDGE_ROW });
        const knowledgeOverride = toKnowledgeDto({ parking: 'Free parking out front' } as any);
        const prompt = await promptFor(previewCtx(prisma, { knowledgeOverride }));
        expect(prompt).toContain('Free parking out front');
        expect(prompt).not.toContain('12 Lagos Avenue');
        expect(prisma.businessKnowledge.findUnique).not.toHaveBeenCalled();
    });

    it('runs the read-only tools: listing services and checking availability', async () => {
        const seen = script([{ name: 'list_services', args: {} }, { name: 'check_availability', args: { serviceId: 's1', date: '2030-01-07' } }]);
        await runAgent(previewCtx(makePrisma()), 'what do you have monday?');
        expect(parsed(seen[0])[0]).toMatchObject({ id: 's1', name: 'Facial' });
        expect(parsed(seen[1])).toMatchObject({ availableTimes: ['10:00'] });
    });

    it('refuses everything that would book, pay, save or look up a customer', async () => {
        const prisma = makePrisma();
        const seen = script([
            { name: 'create_booking', args: { serviceId: 's1', date: '2030-01-07', time: '10:00', customerName: 'A' } },
            { name: 'save_customer_phone', args: { phone: '0241234567' } },
            { name: 'get_payment_link', args: {} },
            { name: 'get_my_bookings', args: {} },
        ]);
        await runAgent(previewCtx(prisma), 'book me');
        for (const m of seen) expect(parsed(m).error).toMatch(/^preview: not available/);
        expect(createBookingAtomic).not.toHaveBeenCalled();
        expect(createPaymentLink).not.toHaveBeenCalled();
        expect(prisma.conversation.update).not.toHaveBeenCalled();
        expect(prisma.booking.findMany).not.toHaveBeenCalled();
        expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    });

    it('lets a shop list products but never create an order', async () => {
        const prisma = makePrisma();
        const seen = script([
            { name: 'list_products', args: {} },
            { name: 'create_order', args: { items: [{ productId: 'p1', quantity: 1 }], customerName: 'A' } },
            { name: 'get_order_status', args: {} },
        ]);
        await runAgent(previewCtx(prisma, {}, 'PRODUCT'), 'serum?');
        expect(parsed(seen[0]).products[0]).toMatchObject({ name: 'Serum' });
        expect(parsed(seen[1]).error).toMatch(/^preview: not available/);
        expect(parsed(seen[2]).error).toMatch(/^preview: not available/);
        expect(createOrderAtomic).not.toHaveBeenCalled();
        expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('reports a hand-off without doing one', async () => {
        script([{ name: 'request_human', args: { reason: 'not covered' } }]);
        const result = await runAgent(previewCtx(makePrisma()), 'can I pay in dollars?');
        expect(result.wantsHuman).toBe(true);
        expect(result.reply).toBe('done');
    });
});
