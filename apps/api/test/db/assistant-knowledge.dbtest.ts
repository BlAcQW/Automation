/**
 * Assistant knowledge, the preview and customer notes on real Postgres,
 * through the real routes, the real guarded Prisma client, real JWTs and the
 * real rate limiter. Only OpenAI is scripted.
 *
 *  - The preview never writes: whatever tools the model asks for, no booking,
 *    order, message, conversation, customer or notification row appears.
 *  - The preview is rate-limited per tenant.
 *  - One tenant can neither read nor overwrite another's knowledge or notes.
 *  - A note from a verified WhatsApp chat creates and links the Customer; one
 *    from a username-only chat is refused and creates nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';

const create = vi.fn();
vi.mock('openai', () => ({
    default: class { chat = { completions: { create: (...a: unknown[]) => create(...a) } }; },
}));

import prismaPlugin from '../../src/plugins/prisma.js';
import errorHandler from '../../src/plugins/error-handler.js';
import rateLimitPlugin from '../../src/plugins/rate-limit.js';
import { bindTenantContext, tenantContextOnRequest } from '../../src/lib/tenant-context.js';
import assistantRoutes from '../../src/routes/assistant/index.js';
import customersRoutes from '../../src/routes/customers/index.js';
import { rawPrisma } from './helpers/db.js';
import { seedConversation, seedService, seedTenant, seedUser } from './helpers/seed.js';

const SECRET = 'dbtest-secret-dbtest-secret-dbtest';
let app: FastifyInstance;

beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test';
    app = Fastify({ logger: false });
    app.addHook('onRequest', tenantContextOnRequest);
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(prismaPlugin);
    await app.register(jwt, { secret: SECRET });
    await app.register(rateLimitPlugin, { max: 1000, timeWindow: '1 minute' });
    app.decorate('authenticate', async (req: any) => {
        const d = await req.jwtVerify();
        req.user = { userId: d.userId, tenantId: d.tenantId, role: d.role };
        bindTenantContext({ tenantId: d.tenantId, userId: d.userId });
    });
    await app.register(assistantRoutes, { prefix: '/assistant' });
    await app.register(customersRoutes, { prefix: '/customers' });
    await app.ready();
});

afterAll(async () => {
    await app?.close();
});

beforeEach(() => {
    create.mockReset();
});

const token = (tenantId: string, userId: string, role: 'OWNER' | 'STAFF' = 'OWNER') =>
    app.jwt.sign({ tenantId, userId, role, type: 'access' });
const call = (method: string, url: string, t: string, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: { authorization: `Bearer ${t}` }, payload: payload as any });

/** Script one model turn that calls every tool named, then a final reply. */
function scriptTools(calls: Array<{ name: string; args: Record<string, unknown> }>) {
    create
        .mockImplementationOnce(async () => ({
            choices: [{ message: {
                role: 'assistant', content: null,
                tool_calls: calls.map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
            } }],
        }))
        .mockImplementationOnce(async () => ({ choices: [{ message: { role: 'assistant', content: 'Here is what I found.' } }] }));
}

async function counts(tenantId: string) {
    const db = rawPrisma();
    const [bookings, orders, messages, conversations, customers, notifications] = await Promise.all([
        db.booking.count({ where: { tenantId } }),
        db.order.count({ where: { tenantId } }),
        db.message.count({ where: { conversation: { tenantId } } }),
        db.conversation.count({ where: { tenantId } }),
        db.customer.count({ where: { tenantId } }),
        db.notification.count({ where: { tenantId } }),
    ]);
    return { bookings, orders, messages, conversations, customers, notifications };
}

describe('preview writes nothing', () => {
    it('SERVICE: booking, phone, payment and hand-off tools leave the database untouched', async () => {
        const tenant = await seedTenant({ depositRequired: true, timezone: 'Africa/Accra' });
        const owner = await seedUser(tenant.id);
        const service = await seedService(tenant.id, { name: 'Facial' });
        await rawPrisma().workingHours.createMany({
            data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tenantId: tenant.id, dayOfWeek: d, startTime: '09:00', endTime: '17:00' })),
        });
        // An unrelated real chat, to prove the preview neither adds to nor touches it.
        const conv = await seedConversation(tenant.id);
        await rawPrisma().message.create({ data: { conversationId: conv.id, direction: 'INBOUND', content: 'hi' } });
        const before = await counts(tenant.id);

        const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
        scriptTools([
            { name: 'list_services', args: {} },
            { name: 'check_availability', args: { serviceId: service.id, date: day } },
            { name: 'create_booking', args: { serviceId: service.id, date: day, time: '10:00', customerName: 'Ama' } },
            { name: 'save_customer_phone', args: { phone: '+233241234567' } },
            { name: 'get_payment_link', args: {} },
            { name: 'get_my_bookings', args: {} },
            { name: 'request_human', args: { reason: 'test' } },
        ]);
        const res = await call('POST', '/assistant/preview', token(tenant.id, owner.id), {
            question: 'Book me a facial',
            knowledge: { address: '12 Lagos Avenue' },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ reply: 'Here is what I found.', handedToTeam: true });
        expect(await counts(tenant.id)).toEqual(before);
        expect(await rawPrisma().businessKnowledge.count()).toBe(0); // posted knowledge is not saved
        expect(await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ state: 'BOT_ACTIVE', customerPhone: conv.customerPhone });

        // The read-only tools really ran against this tenant's data.
        const toolMsgs = create.mock.calls[1][0].messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
        expect(toolMsgs[0][0]).toMatchObject({ id: service.id, name: 'Facial' });
        expect(toolMsgs[1].availableTimes).toContain('10:00');
        for (const r of toolMsgs.slice(2, 6)) expect(r.error).toMatch(/^preview: not available/);
        // The prompt carried the posted knowledge.
        expect(create.mock.calls[0][0].messages[0].content).toContain('Address: 12 Lagos Avenue');
    });

    it('PRODUCT: create_order leaves orders and stock untouched', async () => {
        const tenant = await seedTenant({ businessType: 'PRODUCT' });
        const owner = await seedUser(tenant.id);
        const product = await rawPrisma().product.create({ data: { tenantId: tenant.id, name: 'Serum', price: 90, stock: 3 } });
        const before = await counts(tenant.id);

        scriptTools([
            { name: 'list_products', args: {} },
            { name: 'create_order', args: { items: [{ productId: product.id, quantity: 2 }], customerName: 'Ama' } },
            { name: 'get_order_payment_link', args: {} },
        ]);
        const res = await call('POST', '/assistant/preview', token(tenant.id, owner.id), { question: 'Two serums please' });

        expect(res.statusCode).toBe(200);
        expect(await counts(tenant.id)).toEqual(before);
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3);
    });

    it('is rate-limited: the 21st preview in 10 minutes for one tenant gets a 429', async () => {
        const tenant = await seedTenant();
        const owner = await seedUser(tenant.id);
        create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
        const t = token(tenant.id, owner.id);
        const codes: number[] = [];
        for (let i = 0; i < 21; i++) codes.push((await call('POST', '/assistant/preview', t, { question: `q${i}` })).statusCode);
        expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
        expect(codes[20]).toBe(429);
        expect(create).toHaveBeenCalledTimes(20);
    });
});

describe('knowledge is per tenant', () => {
    it('tenant B cannot read tenant A\'s knowledge, and B saving never touches A\'s row', async () => {
        const a = await seedTenant();
        const b = await seedTenant();
        const ownerA = await seedUser(a.id);
        const ownerB = await seedUser(b.id);

        const saved = await call('PUT', '/assistant/knowledge', token(a.id, ownerA.id), {
            address: 'A street', faqs: [{ question: 'Parking?', answer: 'Yes' }], offerEndsOn: '2030-01-31', offer: '10% off',
        });
        expect(saved.statusCode).toBe(200);

        const readB = await call('GET', '/assistant/knowledge', token(b.id, ownerB.id));
        expect(readB.json().knowledge.address).toBe('');
        expect(readB.json().knowledge.faqs).toEqual([]);

        await call('PUT', '/assistant/knowledge', token(b.id, ownerB.id), { address: 'B street' });
        const rowA = await rawPrisma().businessKnowledge.findUniqueOrThrow({ where: { tenantId: a.id } });
        expect(rowA).toMatchObject({ address: 'A street', updatedByUserId: ownerA.id });
        expect(rowA.faqs).toEqual([{ question: 'Parking?', answer: 'Yes' }]);
        expect(rowA.offerEndsOn?.toISOString().slice(0, 10)).toBe('2030-01-31');

        const readA = await call('GET', '/assistant/knowledge', token(a.id, ownerA.id));
        expect(readA.json().knowledge).toMatchObject({ address: 'A street', offerEndsOn: '2030-01-31', offer: '10% off' });

        // Clearing a list stores NULL, not an empty array or the old value.
        await call('PUT', '/assistant/knowledge', token(a.id, ownerA.id), { address: 'A street' });
        expect((await rawPrisma().businessKnowledge.findUniqueOrThrow({ where: { tenantId: a.id } })).faqs).toBeNull();
    });

    it('staff can read but not save', async () => {
        const a = await seedTenant();
        const staff = await seedUser(a.id, { role: 'STAFF' });
        expect((await call('GET', '/assistant/knowledge', token(a.id, staff.id, 'STAFF'))).statusCode).toBe(200);
        expect((await call('PUT', '/assistant/knowledge', token(a.id, staff.id, 'STAFF'), { address: 'x' })).statusCode).toBe(403);
        expect(await rawPrisma().businessKnowledge.count()).toBe(0);
    });
});

describe('customer notes', () => {
    it('a note from a verified WhatsApp chat creates and links the customer', async () => {
        const a = await seedTenant({ whatsappDisplayNumber: '+233302000000' });
        const staff = await seedUser(a.id, { role: 'STAFF' });
        const conv = await seedConversation(a.id, { externalId: '233241234567', customerPhone: '233241234567' });

        const res = await call('PUT', `/customers/by-conversation/${conv.id}/note`, token(a.id, staff.id, 'STAFF'), { note: 'Prefers Ama' });
        expect(res.statusCode).toBe(200);
        const customer = await rawPrisma().customer.findFirstOrThrow({ where: { tenantId: a.id } });
        expect(customer).toMatchObject({ phone: '+233241234567', notes: 'Prefers Ama', notesUpdatedByUserId: staff.id });
        expect(customer.notesUpdatedAt).toBeInstanceOf(Date);
        expect((await rawPrisma().conversation.findUniqueOrThrow({ where: { id: conv.id } })).customerId).toBe(customer.id);
        const audit = await rawPrisma().auditLog.findFirstOrThrow({ where: { tenantId: a.id, action: 'customer.note_updated' } });
        expect(JSON.stringify(audit.metadata)).not.toContain('Prefers Ama');
    });

    it('a username-only WhatsApp chat is refused and nothing is created', async () => {
        const a = await seedTenant();
        const staff = await seedUser(a.id, { role: 'STAFF' });
        const conv = await seedConversation(a.id, { externalId: 'GH.1234567890123456', customerPhone: '+233241234567' });
        const res = await call('PUT', `/customers/by-conversation/${conv.id}/note`, token(a.id, staff.id, 'STAFF'), { note: 'x' });
        expect(res.statusCode).toBe(409);
        expect(await rawPrisma().customer.count()).toBe(0);
    });

    it('tenant B can neither read nor change tenant A\'s customer note', async () => {
        const a = await seedTenant();
        const b = await seedTenant();
        const ownerB = await seedUser(b.id);
        const customer = await rawPrisma().customer.create({ data: { tenantId: a.id, phone: '+233241234567', notes: 'A only' } });
        const conv = await seedConversation(a.id, { customerId: customer.id });

        expect((await call('GET', `/customers/${customer.id}/note`, token(b.id, ownerB.id))).statusCode).toBe(404);
        expect((await call('PUT', `/customers/${customer.id}/note`, token(b.id, ownerB.id), { note: 'B was here' })).statusCode).toBe(404);
        expect((await call('GET', `/customers/by-conversation/${conv.id}/note`, token(b.id, ownerB.id))).statusCode).toBe(404);
        expect((await rawPrisma().customer.findUniqueOrThrow({ where: { id: customer.id } })).notes).toBe('A only');
    });
});
