import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { TENANT_SCOPED_MODELS } from '../plugins/prisma.js';
import { guardDecision } from '../plugins/tenant-guard.js';

/**
 * Every "verify ownership, then mutate by id" route, driven through the real
 * Fastify stack against a stub Prisma that enforces the blocking tenant guard
 * (the real guardDecision, mode 'block', tenant context always active).
 *
 * Two assertions per route: no guarded query ever ran without a tenantId
 * filter (so the guard would not throw in production), and the mutation that
 * replaced update/delete-by-id is the tenant-scoped updateMany/deleteMany form.
 */

vi.mock('../plugins/prisma.js', async (orig) => {
    const real = await orig<typeof import('../plugins/prisma.js')>();
    return {
        ...real,
        default: fp(async (app: any) => {
            app.decorate('prisma', (globalThis as any).__guardStub);
        }, { name: 'prisma' }),
    };
});

vi.mock('../plugins/auth.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('authenticate', async (request: any, reply: any) => {
            const tenantId = request.headers['x-test-tenant'];
            if (!tenantId) return reply.code(401).send({ message: 'Unauthorized' });
            request.user = { userId: 'user-1', tenantId, role: 'OWNER' };
        });
        app.decorate('authenticateAdmin', async () => undefined);
    }, { name: 'auth' }),
}));

vi.mock('../plugins/redis.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('redis', null);
        app.decorate('queues', { notifications: null, reminders: null });
    }, { name: 'redis' }),
}));

const TENANT = 'tenant-aaa';

interface Query { model: string; op: string; args: any }
const queries: Query[] = [];
const violations: string[] = [];
let countResult = 0;
let manyResult = 1;
let rowOverride: Record<string, unknown> = {};

const GENERIC_ROW = {
    id: 'row-1',
    tenantId: TENANT,
    status: 'PENDING',
    isActive: true,
    role: 'STAFF',
    state: 'HUMAN_ACTIVE',
    assignedUserId: null,
    calendarEventId: null,
    items: [],
    startTime: new Date('2020-01-01T10:00:00Z'),
    emailVerifiedAt: null,
    tenant: { id: TENANT, name: 'Biz', businessType: 'SALON', isActive: true },
    service: { name: 'Cut' },
};

function modelStub(name: string) {
    return new Proxy({}, {
        get(_t, op: string) {
            return async (args: any) => {
                const model = name.charAt(0).toUpperCase() + name.slice(1);
                queries.push({ model: name, op, args });
                const decision = guardDecision({
                    model,
                    operation: op,
                    where: args?.where,
                    ctx: { tenantId: TENANT, userId: 'user-1' },
                    mode: 'block',
                    scopedModels: TENANT_SCOPED_MODELS,
                });
                if (decision !== 'allow') violations.push(`${model}.${op} ${JSON.stringify(args?.where)}`);
                if (op === 'findMany') return [];
                if (op === 'count') return countResult;
                if (op === 'updateMany' || op === 'deleteMany') return { count: manyResult };
                return { ...GENERIC_ROW, ...rowOverride };
            };
        },
    });
}

const stub: any = new Proxy({}, {
    get(target: any, prop: string) {
        if (prop === '$transaction') {
            return async (arg: any) => (typeof arg === 'function' ? arg(stub) : Promise.all(arg));
        }
        if (prop === '$connect' || prop === '$disconnect') return async () => undefined;
        if (prop === 'then') return undefined;
        if (!target[prop]) target[prop] = modelStub(prop);
        return target[prop];
    },
});
(globalThis as any).__guardStub = stub;

let app: FastifyInstance;

beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation-x';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-long-enough-for-validation';
    process.env.ADMIN_JWT_SECRET ??= 'test-admin-secret-long-enough-for-validation-x';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
    const { buildApp } = await import('../index.js');
    app = await buildApp();
    await app.ready();
});

afterAll(async () => {
    await app?.close();
});

beforeEach(() => {
    queries.length = 0;
    violations.length = 0;
    countResult = 0;
    manyResult = 1;
    rowOverride = {};
});

async function call(method: string, url: string, payload?: unknown) {
    return app.inject({
        method: method as any,
        url,
        payload: payload as any,
        headers: { 'x-test-tenant': TENANT },
    });
}

function find(model: string, op: string) {
    return queries.filter((q) => q.model === model && q.op === op);
}

interface Case {
    name: string;
    method: string;
    url: string;
    payload?: unknown;
    /** the scoped mutation that must have run */
    expects: { model: string; op: string; where: Record<string, unknown> };
    /** and the unscoped form that must NOT have run */
    forbids?: Array<{ model: string; op: string }>;
    /** the route has side effects the stub cannot satisfy; only the guard is asserted */
    anyStatus?: boolean;
}

const cases: Case[] = [
    { name: 'PATCH /services/:id', method: 'PATCH', url: '/services/s1', payload: { name: 'Cut' },
      expects: { model: 'service', op: 'updateMany', where: { id: 's1', tenantId: TENANT } }, forbids: [{ model: 'service', op: 'update' }] },
    { name: 'POST /services/:id/toggle', method: 'POST', url: '/services/s1/toggle',
      expects: { model: 'service', op: 'updateMany', where: { id: 's1', tenantId: TENANT } }, forbids: [{ model: 'service', op: 'update' }] },
    { name: 'DELETE /services/:id (no bookings)', method: 'DELETE', url: '/services/s1',
      expects: { model: 'service', op: 'deleteMany', where: { id: 's1', tenantId: TENANT } }, forbids: [{ model: 'service', op: 'delete' }] },
    { name: 'PATCH /availability/hours/:day', method: 'PATCH', url: '/availability/hours/2', payload: { startTime: '08:00' },
      expects: { model: 'workingHours', op: 'update', where: { tenantId_dayOfWeek: { tenantId: TENANT, dayOfWeek: 2 } } } },
    { name: 'DELETE /availability/blackouts/:id', method: 'DELETE', url: '/availability/blackouts/b1',
      expects: { model: 'blackoutDate', op: 'deleteMany', where: { id: 'b1', tenantId: TENANT } }, forbids: [{ model: 'blackoutDate', op: 'delete' }] },
    { name: 'PATCH /bookings/:id', method: 'PATCH', url: '/bookings/b1', payload: { notes: 'hi' },
      expects: { model: 'booking', op: 'updateMany', where: { id: 'b1', tenantId: TENANT } }, forbids: [{ model: 'booking', op: 'update' }] },
    { name: 'PATCH /products/:id', method: 'PATCH', url: '/products/p1', payload: { name: 'Shoe' },
      expects: { model: 'product', op: 'updateMany', where: { id: 'p1', tenantId: TENANT } }, forbids: [{ model: 'product', op: 'update' }] },
    { name: 'PATCH /products/:id/toggle', method: 'PATCH', url: '/products/p1/toggle',
      expects: { model: 'product', op: 'updateMany', where: { id: 'p1', tenantId: TENANT } }, forbids: [{ model: 'product', op: 'update' }] },
    { name: 'PATCH /products/:id/stock', method: 'PATCH', url: '/products/p1/stock', payload: { stock: 3 },
      expects: { model: 'product', op: 'updateMany', where: { id: 'p1', tenantId: TENANT } }, forbids: [{ model: 'product', op: 'update' }] },
    { name: 'DELETE /products/:id', method: 'DELETE', url: '/products/p1',
      expects: { model: 'product', op: 'deleteMany', where: { id: 'p1', tenantId: TENANT } }, forbids: [{ model: 'product', op: 'delete' }] },
    { name: 'PATCH /templates/:id', method: 'PATCH', url: '/templates/t1', payload: { bodyPreview: 'x' },
      expects: { model: 'messageTemplate', op: 'updateMany', where: { id: 't1', tenantId: TENANT } }, forbids: [{ model: 'messageTemplate', op: 'update' }] },
    { name: 'DELETE /templates/:id', method: 'DELETE', url: '/templates/t1',
      expects: { model: 'messageTemplate', op: 'deleteMany', where: { id: 't1', tenantId: TENANT } }, forbids: [{ model: 'messageTemplate', op: 'delete' }] },
    { name: 'PATCH /notifications/:id/read', method: 'PATCH', url: '/notifications/n1/read',
      expects: { model: 'notification', op: 'updateMany', where: { id: 'n1', tenantId: TENANT } }, forbids: [{ model: 'notification', op: 'update' }] },
    { name: 'PATCH /orders/:id', method: 'PATCH', url: '/orders/o1', payload: { notes: 'x' },
      expects: { model: 'order', op: 'updateMany', where: { id: 'o1', tenantId: TENANT } }, forbids: [{ model: 'order', op: 'update' }] },
    { name: 'POST /orders/:id/cancel', method: 'POST', url: '/orders/o1/cancel',
      expects: { model: 'order', op: 'updateMany', where: { id: 'o1', tenantId: TENANT, status: { notIn: ['CANCELLED', 'DELIVERED'] } } }, forbids: [{ model: 'order', op: 'update' }] },
    { name: 'POST /conversations/:id/resume-bot', method: 'POST', url: '/conversations/c1/resume-bot',
      expects: { model: 'conversation', op: 'updateMany', where: { id: 'c1', tenantId: TENANT, state: 'HUMAN_ACTIVE' } }, forbids: [{ model: 'conversation', op: 'update' }] },
    { name: 'POST /conversations/:id/activate-human', method: 'POST', url: '/conversations/c1/activate-human',
      expects: { model: 'conversation', op: 'updateMany', where: { id: 'c1', tenantId: TENANT, state: { not: 'HUMAN_ACTIVE' } } }, forbids: [{ model: 'conversation', op: 'update' }] },
    { name: 'POST /conversations/:id/assign', method: 'POST', url: '/conversations/c1/assign',
      expects: { model: 'conversation', op: 'updateMany', where: { id: 'c1', tenantId: TENANT } }, forbids: [{ model: 'conversation', op: 'update' }] },
    { name: 'PATCH /users/:id', method: 'PATCH', url: '/users/u2', payload: { name: 'Bob' },
      expects: { model: 'user', op: 'updateMany', where: { id: 'u2', tenantId: TENANT } }, forbids: [{ model: 'user', op: 'update' }] },
    { name: 'GET /auth/me', method: 'GET', url: '/auth/me',
      expects: { model: 'user', op: 'findFirst', where: { id: 'user-1', tenantId: TENANT } }, forbids: [{ model: 'user', op: 'findUnique' }] },
    { name: 'PATCH /auth/profile (name)', method: 'PATCH', url: '/auth/profile', payload: { name: 'Bob' },
      expects: { model: 'user', op: 'updateMany', where: { id: 'user-1', tenantId: TENANT } }, forbids: [{ model: 'user', op: 'update' }] },
    { name: 'POST /auth/change-password', method: 'POST', url: '/auth/change-password',
      payload: { currentPassword: 'old-password', newPassword: 'new-password-1' }, anyStatus: true,
      expects: { model: 'user', op: 'findFirst', where: { id: 'user-1', tenantId: TENANT } }, forbids: [{ model: 'user', op: 'findUnique' }, { model: 'user', op: 'update' }] },
    { name: 'POST /auth/resend-verification', method: 'POST', url: '/auth/resend-verification', anyStatus: true,
      expects: { model: 'user', op: 'findFirst', where: { id: 'user-1', tenantId: TENANT } }, forbids: [{ model: 'user', op: 'findUnique' }] },
    { name: 'POST /auth/delete-request', method: 'POST', url: '/auth/delete-request', payload: {}, anyStatus: true,
      expects: { model: 'user', op: 'findFirst', where: { id: 'user-1', tenantId: TENANT } }, forbids: [{ model: 'user', op: 'findUnique' }] },
    { name: 'DELETE /devices/:token', method: 'DELETE', url: '/devices/tok',
      expects: { model: 'deviceToken', op: 'deleteMany', where: { token: 'tok', userId: 'user-1', tenantId: TENANT } } },
];

describe('converted routes satisfy the blocking tenant guard', () => {
    it.each(cases)('$name', async (c) => {
        const res = await call(c.method, c.url, c.payload);

        expect(violations, `unscoped guarded queries: ${violations.join(' | ')}`).toEqual([]);
        if (!c.anyStatus) expect(res.statusCode, res.body).toBeLessThan(500);

        const ran = find(c.expects.model, c.expects.op);
        expect(ran.length, `${c.expects.model}.${c.expects.op} never ran (status ${res.statusCode}: ${res.body})`).toBe(1);
        expect(ran[0].args.where).toEqual(c.expects.where);
        for (const f of c.forbids ?? []) {
            expect(find(f.model, f.op), `${f.model}.${f.op} by bare id is back`).toHaveLength(0);
        }
    });

    it('DELETE /services/:id with bookings soft-deletes, and counts only this tenant bookings', async () => {
        countResult = 2;
        const res = await call('DELETE', '/services/s1');

        expect(res.json()).toEqual({ deleted: false, deactivated: true });
        expect(violations).toEqual([]);
        expect(find('booking', 'count')[0].args.where).toEqual({ serviceId: 's1', tenantId: TENANT });
        expect(find('service', 'updateMany')[0].args).toMatchObject({
            where: { id: 's1', tenantId: TENANT },
            data: { isActive: false },
        });
        expect(find('service', 'deleteMany')).toHaveLength(0);
    });
});

describe('response shapes are unchanged', () => {
    it('returns the re-read service row from PATCH /services/:id', async () => {
        const res = await call('PATCH', '/services/s1', { name: 'Cut' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: 'row-1', tenantId: TENANT });
    });

    it('resume-bot / activate-human / assign keep their documented fields', async () => {
        expect((await call('POST', '/conversations/c1/resume-bot')).json())
            .toEqual({ id: 'c1', state: 'BOT_ACTIVE', message: 'Bot resumed successfully' });
        expect((await call('POST', '/conversations/c1/activate-human')).json())
            .toEqual({ id: 'c1', state: 'HUMAN_ACTIVE' });
        queries.length = 0;
    });

    it('returns 404 and not a 500 when a scoped write matches nothing', async () => {
        manyResult = 0;
        const res = await call('PATCH', '/services/s1', { name: 'Cut' });
        expect(res.statusCode).toBe(404);
    });
});

describe('cancelling a booking from the dashboard stays tenant-scoped end to end', () => {
    it('POST /bookings/:id/cancel scopes the lookup and the status write', async () => {
        rowOverride = { status: 'CONFIRMED', bookingReference: 'BK-1', customerPhone: '+233241234567' };
        const res = await call('POST', '/bookings/b1/cancel');

        expect(violations, violations.join(' | ')).toEqual([]);
        expect(res.statusCode, res.body).toBe(200);
        expect(find('booking', 'updateMany')[0].args.where).toEqual({ id: 'b1', tenantId: TENANT, status: 'CONFIRMED' });
        expect(find('booking', 'update')).toHaveLength(0);
        expect(find('booking', 'findUnique')).toHaveLength(0);
    });
});
