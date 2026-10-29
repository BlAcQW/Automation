/**
 * Staff notes on customers, through the customers routes: any staff member can
 * read and write, every query is scoped to the caller's tenant (the stub
 * enforces the blocking tenant guard), changes are audited without the text,
 * and a note is never attached to an unverified identity.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import errorHandler from '../../plugins/error-handler.js';
import { TENANT_SCOPED_MODELS } from '../../plugins/prisma.js';
import { guardDecision, TenantGuardError } from '../../plugins/tenant-guard.js';
import { bindTenantContext, getTenantContext, tenantContextOnRequest } from '../../lib/tenant-context.js';
import customersRoutes from './index.js';

const A = 'tenant-a';
const B = 'tenant-b';

type Row = Record<string, any>;
let customers: Row[];
let conversations: Row[];
let queries: Array<{ model: string; op: string; args: any }>;
let violations: string[];

const where = (rows: Row[], w: Row) => rows.filter((r) => Object.entries(w).every(([k, v]) =>
    v && typeof v === 'object' && 'in' in v ? (v.in as unknown[]).includes(r[k]) : r[k] === v));

function prismaStub() {
    const handlers: Record<string, Record<string, (args: any) => unknown>> = {
        customer: {
            findFirst: ({ where: w }) => where(customers, w)[0] ?? null,
            findUnique: ({ where: w }) => customers.find((c) => c.tenantId === w.tenantId_phone.tenantId && c.phone === w.tenantId_phone.phone) ?? null,
            create: ({ data }) => { const row = { id: `cust-${customers.length + 1}`, notes: null, ...data }; customers.push(row); return row; },
            count: ({ where: w }) => where(customers, w).length,
            updateMany: ({ where: w, data }) => { const hit = where(customers, w); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
        },
        conversation: {
            findFirst: ({ where: w }) => where(conversations, w)[0] ?? null,
            updateMany: ({ where: w, data }) => { const hit = where(conversations, w); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
        },
        user: { findFirst: () => ({ name: 'Kwame Staff' }) },
        tenant: { findUnique: () => ({ whatsappDisplayNumber: '+233302000000' }) },
        auditLog: { create: ({ data }) => ({ id: 'a1', ...data }) },
        domainEvent: { create: ({ data }) => ({ id: 'e1', ...data }) },
    };
    return new Proxy({}, {
        get(_t, model: string) {
            if (model === 'then') return undefined;
            if (model === '$transaction') return async (fn: any) => fn(this);
            return new Proxy({}, {
                get(_m, op: string) {
                    return async (args: any) => {
                        const Model = model.charAt(0).toUpperCase() + model.slice(1);
                        queries.push({ model, op, args });
                        const decision = guardDecision({ model: Model, operation: op, where: args?.where, ctx: getTenantContext(), mode: 'block', scopedModels: TENANT_SCOPED_MODELS });
                        if (decision !== 'allow') { violations.push(`${Model}.${op}`); throw new TenantGuardError(Model, op); }
                        const h = handlers[model]?.[op];
                        return h ? h(args) : null;
                    };
                },
            });
        },
    });
}

async function build(tenantId: string, role: 'OWNER' | 'STAFF' = 'STAFF'): Promise<FastifyInstance> {
    const app = Fastify();
    app.addHook('onRequest', tenantContextOnRequest);
    await app.register(sensible);
    await app.register(errorHandler);
    app.decorate('prisma', prismaStub() as any);
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId: `user-${tenantId}`, tenantId, role };
        bindTenantContext({ tenantId, userId: `user-${tenantId}` });
    });
    await app.register(customersRoutes, { prefix: '/customers' });
    return app;
}

beforeEach(() => {
    queries = []; violations = [];
    customers = [
        { id: 'cust-a', tenantId: A, phone: '+233241234567', notes: 'Prefers Ama', notesUpdatedAt: new Date('2026-10-01'), notesUpdatedByUserId: 'u-1' },
    ];
    conversations = [
        { id: 'conv-verified', tenantId: A, channel: 'WHATSAPP', externalId: '233205555555', customerPhone: '233205555555', customerId: null },
        { id: 'conv-linked', tenantId: A, channel: 'WHATSAPP', externalId: '233241234567', customerPhone: '233241234567', customerId: 'cust-a' },
        { id: 'conv-bsuid', tenantId: A, channel: 'WHATSAPP', externalId: 'GH.1234567890123456', customerPhone: '+233241234567', customerId: null },
        { id: 'conv-ig', tenantId: A, channel: 'INSTAGRAM', externalId: '1789', customerPhone: '+233241234567', customerId: null },
    ];
});

describe('GET/PUT /customers/:customerId/note', () => {
    it('any staff member can read a note, with who changed it last', async () => {
        const res = await (await build(A)).inject({ method: 'GET', url: '/customers/cust-a/note' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ customerId: 'cust-a', note: 'Prefers Ama', updatedBy: { name: 'Kwame Staff' } });
        expect(violations).toEqual([]);
    });

    it('any staff member can write one; who and when are recorded', async () => {
        const res = await (await build(A, 'STAFF')).inject({ method: 'PUT', url: '/customers/cust-a/note', payload: { note: 'Likes the window seat' } });
        expect(res.statusCode).toBe(200);
        expect(customers[0]).toMatchObject({ notes: 'Likes the window seat', notesUpdatedByUserId: `user-${A}` });
        const upd = queries.find((q) => q.model === 'customer' && q.op === 'updateMany')!;
        expect(upd.args.where).toEqual({ id: 'cust-a', tenantId: A });
    });

    it('audits the change without the note text', async () => {
        await (await build(A)).inject({ method: 'PUT', url: '/customers/cust-a/note', payload: { note: 'Allergic to latex' } });
        const audit = queries.find((q) => q.model === 'auditLog')!;
        expect(audit.args.data).toMatchObject({ tenantId: A, action: 'customer.note_updated', targetType: 'Customer', targetId: 'cust-a', actorId: `user-${A}` });
        expect(JSON.stringify(audit.args.data)).not.toMatch(/latex/i);
    });

    it('another tenant can neither read nor write it (404, nothing changed)', async () => {
        const app = await build(B, 'OWNER');
        expect((await app.inject({ method: 'GET', url: '/customers/cust-a/note' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'PUT', url: '/customers/cust-a/note', payload: { note: 'hijack' } })).statusCode).toBe(404);
        expect(customers[0].notes).toBe('Prefers Ama');
        expect(queries.filter((q) => q.model === 'customer').every((q) => q.args.where.tenantId === B)).toBe(true);
    });

    it('refuses a note over 1000 characters', async () => {
        const res = await (await build(A)).inject({ method: 'PUT', url: '/customers/cust-a/note', payload: { note: 'a'.repeat(1001) } });
        expect(res.statusCode).toBe(400);
        expect(customers[0].notes).toBe('Prefers Ama');
    });
});

describe('GET/PUT /customers/by-conversation/:conversationId/note', () => {
    it('a verified WhatsApp chat with no customer yet: eligible, empty note, nothing created by reading', async () => {
        const res = await (await build(A)).inject({ method: 'GET', url: '/customers/by-conversation/conv-verified/note' });
        expect(res.json()).toMatchObject({ eligible: true, customerId: null, note: '' });
        expect(customers).toHaveLength(1);
    });

    it('saving from a verified chat creates the customer and links the chat, then stores the note', async () => {
        const res = await (await build(A)).inject({ method: 'PUT', url: '/customers/by-conversation/conv-verified/note', payload: { note: 'Regular, likes Kojo' } });
        expect(res.statusCode).toBe(200);
        const created = customers.find((c) => c.phone === '+233205555555')!;
        expect(created).toMatchObject({ tenantId: A, notes: 'Regular, likes Kojo' });
        expect(conversations[0].customerId).toBe(created.id);
        expect(res.json()).toMatchObject({ eligible: true, customerId: created.id, note: 'Regular, likes Kojo' });
        expect(violations).toEqual([]);
    });

    it('a linked chat reads its customer\'s note', async () => {
        const res = await (await build(A)).inject({ method: 'GET', url: '/customers/by-conversation/conv-linked/note' });
        expect(res.json()).toMatchObject({ eligible: true, customerId: 'cust-a', note: 'Prefers Ama' });
    });

    it.each([
        ['a username-only WhatsApp chat', 'conv-bsuid', 'username_only'],
        ['an Instagram chat with a typed phone', 'conv-ig', 'unverified_channel'],
    ])('%s is not eligible, shows no one\'s note, and cannot be written to', async (_l, id, reason) => {
        const app = await build(A);
        const get = await app.inject({ method: 'GET', url: `/customers/by-conversation/${id}/note` });
        expect(get.json()).toEqual({ eligible: false, reason, customerId: null, note: '', updatedAt: null, updatedBy: null });
        const put = await app.inject({ method: 'PUT', url: `/customers/by-conversation/${id}/note`, payload: { note: 'x' } });
        expect(put.statusCode).toBe(409);
        expect(put.json().message).toMatch(/verified/i);
        expect(customers).toHaveLength(1);
        expect(customers[0].notes).toBe('Prefers Ama');
    });

    it('another tenant\'s conversation is a 404', async () => {
        const app = await build(B);
        expect((await app.inject({ method: 'GET', url: '/customers/by-conversation/conv-linked/note' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'PUT', url: '/customers/by-conversation/conv-linked/note', payload: { note: 'x' } })).statusCode).toBe(404);
        expect(customers[0].notes).toBe('Prefers Ama');
    });
});
