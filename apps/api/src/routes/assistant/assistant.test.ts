/**
 * /assistant routes through a real Fastify stack: real JWT verification, the
 * real per-identity rate limiter, the real error handler, and a stub Prisma
 * that enforces the blocking tenant guard with the context auth bound. So a
 * query that forgets the caller's tenantId fails here as it would in
 * production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import errorHandler from '../../plugins/error-handler.js';
import rateLimitPlugin from '../../plugins/rate-limit.js';
import { TENANT_SCOPED_MODELS } from '../../plugins/prisma.js';
import { guardDecision, TenantGuardError } from '../../plugins/tenant-guard.js';
import { bindTenantContext, getTenantContext, tenantContextOnRequest } from '../../lib/tenant-context.js';

const previewAssistant = vi.fn();
vi.mock('../../services/assistant-preview.js', () => ({ previewAssistant: (...a: unknown[]) => previewAssistant(...a) }));
let llmEnabled = true;
vi.mock('../../services/llm-agent.js', () => ({ isLlmEnabled: () => llmEnabled }));

import assistantRoutes from './index.js';

const SECRET = 'test-secret-test-secret-test-secret';
const A = 'tenant-a';
const B = 'tenant-b';

interface Query { model: string; op: string; args: any }
let queries: Query[];
let violations: string[];
let rows: Record<string, any>;

function prismaStub() {
    const model = (name: string) => new Proxy({}, {
        get(_t, op: string) {
            return async (args: any) => {
                const Model = name.charAt(0).toUpperCase() + name.slice(1);
                queries.push({ model: name, op, args });
                const decision = guardDecision({
                    model: Model, operation: op, where: args?.where, ctx: getTenantContext(), mode: 'block', scopedModels: TENANT_SCOPED_MODELS,
                });
                if (decision !== 'allow') { violations.push(`${Model}.${op}`); throw new TenantGuardError(Model, op); }
                if (name === 'businessKnowledge' && op === 'findUnique') return rows[args.where.tenantId] ?? null;
                if (name === 'businessKnowledge' && op === 'upsert') {
                    const row = { id: `bk-${args.where.tenantId}`, tenantId: args.where.tenantId, ...args.create, ...args.update, updatedAt: new Date('2026-10-29T10:00:00Z') };
                    rows[args.where.tenantId] = row;
                    return row;
                }
                if (name === 'user' && op === 'findFirst') return { name: 'Efua Owner' };
                if (op === 'create') return { id: 'audit-1', ...args.data };
                return null;
            };
        },
    });
    return new Proxy({}, { get: (t: any, p: string) => (p === 'then' ? undefined : (t[p] ??= model(p))) });
}

async function build(): Promise<FastifyInstance> {
    const app = Fastify();
    app.addHook('onRequest', tenantContextOnRequest);
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(jwt, { secret: SECRET });
    await app.register(rateLimitPlugin, { max: 1000, timeWindow: '1 minute' });
    app.decorate('prisma', prismaStub() as any);
    app.decorate('authenticate', async (req: any) => {
        const d = await req.jwtVerify();
        req.user = { userId: d.userId, tenantId: d.tenantId, role: d.role };
        bindTenantContext({ tenantId: d.tenantId, userId: d.userId });
    });
    await app.register(assistantRoutes, { prefix: '/assistant' });
    return app;
}

const tokenFor = (app: FastifyInstance, tenantId: string, role: 'OWNER' | 'STAFF', userId = `${role}-${tenantId}`) =>
    app.jwt.sign({ userId, tenantId, role, type: 'access' });
const call = (app: FastifyInstance, method: string, url: string, token: string, payload?: unknown) =>
    app.inject({ method: method as any, url, headers: { authorization: `Bearer ${token}` }, payload: payload as any });

beforeEach(() => {
    queries = []; violations = []; rows = {};
    previewAssistant.mockReset();
    previewAssistant.mockResolvedValue({ reply: 'We are at 12 Lagos Avenue.', handedToTeam: false });
    llmEnabled = true;
});

describe('GET /assistant/knowledge', () => {
    it('any staff member can read it; empty fields come back empty, not missing', async () => {
        const app = await build();
        const res = await call(app, 'GET', '/assistant/knowledge', tokenFor(app, A, 'STAFF'));
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.knowledge.address).toBe('');
        expect(body.knowledge.faqs).toEqual([]);
        expect(body.canEdit).toBe(false);
        expect(body.completeness).toEqual({ filled: [], total: 10 });
        expect(violations).toEqual([]);
    });

    it('reads only the caller\'s tenant: tenant B never sees tenant A\'s knowledge', async () => {
        const app = await build();
        rows[A] = { id: 'bk-a', tenantId: A, address: 'A street', updatedAt: new Date(), updatedByUserId: 'u' };
        const res = await call(app, 'GET', '/assistant/knowledge', tokenFor(app, B, 'OWNER'));
        expect(res.json().knowledge.address).toBe('');
        const reads = queries.filter((q) => q.model === 'businessKnowledge');
        expect(reads.every((q) => q.args.where.tenantId === B)).toBe(true);
    });

    it('ignores a tenantId in the query string', async () => {
        const app = await build();
        rows[A] = { id: 'bk-a', tenantId: A, address: 'A street', updatedAt: new Date() };
        const res = await call(app, 'GET', `/assistant/knowledge?tenantId=${A}`, tokenFor(app, B, 'OWNER'));
        expect(res.json().knowledge.address).toBe('');
    });

    it('needs a valid token', async () => {
        const app = await build();
        const res = await app.inject({ method: 'GET', url: '/assistant/knowledge' });
        expect(res.statusCode).toBe(401);
    });
});

describe('PUT /assistant/knowledge', () => {
    const body = {
        address: '12 Lagos Avenue, East Legon',
        mapsUrl: 'https://maps.app.goo.gl/AbC123',
        faqs: [{ question: 'Parking?', answer: 'Free, out front.' }],
    };

    it('the owner can save it: upserted for the caller\'s tenant, with who saved it', async () => {
        const app = await build();
        const res = await call(app, 'PUT', '/assistant/knowledge', tokenFor(app, A, 'OWNER', 'owner-1'), body);
        expect(res.statusCode).toBe(200);
        const upsert = queries.find((q) => q.model === 'businessKnowledge' && q.op === 'upsert')!;
        expect(upsert.args.where).toEqual({ tenantId: A });
        expect(upsert.args.create).toMatchObject({ tenantId: A, address: '12 Lagos Avenue, East Legon', updatedByUserId: 'owner-1' });
        expect(upsert.args.update).toMatchObject({ address: '12 Lagos Avenue, East Legon', updatedByUserId: 'owner-1' });
        expect(upsert.args.update.tenantId).toBeUndefined();
        expect(res.json().knowledge.faqs).toEqual([{ question: 'Parking?', answer: 'Free, out front.' }]);
        expect(res.json().updatedBy).toEqual({ name: 'Efua Owner' });
        expect(violations).toEqual([]);
    });

    it('writes an audit entry naming the sections, never the content', async () => {
        const app = await build();
        await call(app, 'PUT', '/assistant/knowledge', tokenFor(app, A, 'OWNER', 'owner-1'), body);
        const audit = queries.find((q) => q.model === 'auditLog' && q.op === 'create')!;
        expect(audit.args.data).toMatchObject({ tenantId: A, actorType: 'USER', actorId: 'owner-1', action: 'assistant.knowledge_updated' });
        expect(JSON.stringify(audit.args.data)).not.toContain('Lagos Avenue');
        expect(audit.args.data.metadata.sectionsFilled).toEqual(['location', 'faqs']);
    });

    it('staff cannot change it', async () => {
        const app = await build();
        const res = await call(app, 'PUT', '/assistant/knowledge', tokenFor(app, A, 'STAFF'), body);
        expect(res.statusCode).toBe(403);
        expect(queries.some((q) => q.op === 'upsert')).toBe(false);
    });

    it('a support session (read-only by design) cannot save, even with an owner role', async () => {
        const app = await build();
        const support = app.jwt.sign({ userId: 'owner-a', tenantId: A, role: 'OWNER', type: 'access' });
        app.addHook('preHandler', async (req: any) => { req.user.support = { sessionId: 's', adminId: 'adm' }; });
        const res = await call(app, 'PUT', '/assistant/knowledge', support, body);
        expect(res.statusCode).toBe(403);
        expect(queries.some((q) => q.op === 'upsert')).toBe(false);
    });

    it('refuses a tenantId in the body (cannot write another tenant\'s row)', async () => {
        const app = await build();
        const res = await call(app, 'PUT', '/assistant/knowledge', tokenFor(app, B, 'OWNER'), { ...body, tenantId: A });
        expect(res.statusCode).toBe(400);
        expect(queries.some((q) => q.op === 'upsert')).toBe(false);
    });

    it('refuses an http map link and over-long fields with a 400 naming the field', async () => {
        const app = await build();
        const http = await call(app, 'PUT', '/assistant/knowledge', tokenFor(app, A, 'OWNER'), { mapsUrl: 'http://maps.google.com' });
        expect(http.statusCode).toBe(400);
        expect(http.json().fields[0].field).toBe('mapsUrl');
        const long = await call(app, 'PUT', '/assistant/knowledge', tokenFor(app, A, 'OWNER'), { address: 'a'.repeat(501) });
        expect(long.statusCode).toBe(400);
    });
});

describe('POST /assistant/preview', () => {
    it('runs the preview for the caller\'s tenant and returns the reply', async () => {
        const app = await build();
        const res = await call(app, 'POST', '/assistant/preview', tokenFor(app, A, 'STAFF'), { question: 'Where are you?' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ reply: 'We are at 12 Lagos Avenue.', handedToTeam: false });
        expect(previewAssistant).toHaveBeenCalledTimes(1);
        const [, args] = previewAssistant.mock.calls[0];
        expect(args).toMatchObject({ tenantId: A, question: 'Where are you?' });
        expect(args.knowledge).toBeUndefined();
    });

    it('passes posted, unsaved knowledge through validation to the preview', async () => {
        const app = await build();
        await call(app, 'POST', '/assistant/preview', tokenFor(app, A, 'OWNER'), {
            question: 'Parking?', knowledge: { parking: '  Free out front  ' },
        });
        const [, args] = previewAssistant.mock.calls[0];
        expect(args.knowledge.parking).toBe('Free out front');
        expect(args.knowledge.address).toBe('');
    });

    it('refuses invalid posted knowledge and an empty or huge question', async () => {
        const app = await build();
        const t = tokenFor(app, A, 'OWNER');
        expect((await call(app, 'POST', '/assistant/preview', t, { question: 'x', knowledge: { mapsUrl: 'http://x.y' } })).statusCode).toBe(400);
        expect((await call(app, 'POST', '/assistant/preview', t, { question: '   ' })).statusCode).toBe(400);
        expect((await call(app, 'POST', '/assistant/preview', t, { question: 'a'.repeat(501) })).statusCode).toBe(400);
        expect(previewAssistant).not.toHaveBeenCalled();
    });

    it('says plainly when the assistant is not switched on', async () => {
        llmEnabled = false;
        const app = await build();
        const res = await call(app, 'POST', '/assistant/preview', tokenFor(app, A, 'OWNER'), { question: 'Hi' });
        expect(res.statusCode).toBe(503);
        expect(previewAssistant).not.toHaveBeenCalled();
    });

    it('is limited to 20 per 10 minutes per tenant, across that tenant\'s users', async () => {
        const app = await build();
        const owner = tokenFor(app, A, 'OWNER', 'owner-a');
        const staff = tokenFor(app, A, 'STAFF', 'staff-a');
        const codes: number[] = [];
        for (let i = 0; i < 20; i++) codes.push((await call(app, 'POST', '/assistant/preview', i % 2 ? owner : staff, { question: `q${i}` })).statusCode);
        expect(codes.every((c) => c === 200)).toBe(true);
        expect((await call(app, 'POST', '/assistant/preview', staff, { question: 'one more' })).statusCode).toBe(429);
        // Another tenant has its own budget.
        expect((await call(app, 'POST', '/assistant/preview', tokenFor(app, B, 'OWNER'), { question: 'hi' })).statusCode).toBe(200);
        expect(previewAssistant).toHaveBeenCalledTimes(21);
    });
});
