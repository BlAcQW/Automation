import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

// Replace the database plugin before index.ts is imported. buildApp() registers
// it and calls $connect(), which would otherwise try to reach a real Postgres.
vi.mock('../plugins/prisma.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('prisma', (globalThis as any).__prismaStub);
    }, { name: 'prisma' }),
}));

// Routes capture `fastify.authenticate` when they register, so it has to be
// replaced before buildApp() runs, not after. The stub authenticates whoever
// the x-test-tenant header names, and 401s without it — which lets one file
// cover both "scoped correctly" and "rejects anonymous".
vi.mock('../plugins/auth.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('authenticate', async (request: any, reply: any) => {
            const tenantId = request.headers['x-test-tenant'];
            if (!tenantId) {
                return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' });
            }
            request.user = { userId: 'user-1', tenantId, role: 'OWNER' };
        });
        app.decorate('authenticateAdmin', async () => undefined);
    }, { name: 'auth' }),
}));

// Redis is optional at runtime; keep it out of the test entirely.
vi.mock('../plugins/redis.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('redis', null);
        app.decorate('queues', { notifications: null, reminders: null });
    }, { name: 'redis' }),
}));

/**
 * Cross-tenant isolation, tested at the HTTP boundary.
 *
 * Every route scopes its queries with `where: { id, tenantId }`, which is
 * correct — but it is correct by discipline, and nothing enforced it. One
 * refactor that drops a `tenantId` would leak one business's bookings to
 * another and every existing test would still pass, because 14 of the 15 test
 * files exercise services in isolation and never touch a route.
 *
 * These tests drive the real Fastify stack through `app.inject()` with a
 * stubbed database, asserting on the WHERE clause each route actually builds.
 */

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';

/** Records every query so we can assert on how it was scoped. */
const queries: Array<{ model: string; op: string; args: any }> = [];

function recorder(model: string) {
    const spy = (op: string) => vi.fn(async (args: any) => {
        queries.push({ model, op, args });
        return op === 'findMany' ? [] : null;
    });
    return {
        findFirst: spy('findFirst'),
        findUnique: spy('findUnique'),
        findMany: spy('findMany'),
        update: spy('update'),
        updateMany: spy('updateMany'),
        delete: spy('delete'),
        create: spy('create'),
        count: vi.fn(async () => 0),
    };
}

const prismaStub: any = new Proxy({}, {
    get(target: any, prop: string) {
        if (prop === '$transaction') return async (ops: any[]) => Promise.all(ops);
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe') return async () => [{ '?column?': 1 }];
        if (prop === '$connect' || prop === '$disconnect') return async () => undefined;
        if (!target[prop]) target[prop] = recorder(prop);
        return target[prop];
    },
});

(globalThis as any).__prismaStub = prismaStub;

let app: FastifyInstance;

beforeAll(async () => {
    // Keep the app off the network and off a real database.
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

function scopedQueries(model: string) {
    return queries.filter((q) => q.model === model);
}

describe('cross-tenant isolation', () => {
    it('scopes a booking lookup to the caller tenant, not the id alone', async () => {
        queries.length = 0;
        await app.inject({ method: 'GET', url: '/bookings/some-booking-id', headers: { 'x-test-tenant': TENANT_A } });

        const reads = scopedQueries('booking').filter((q) => q.op.startsWith('find'));
        expect(reads.length).toBeGreaterThan(0);
        for (const q of reads) {
            const where = q.args?.where ?? {};
            expect(
                where.tenantId,
                `booking.${q.op} ran without a tenantId — another tenant's booking would be readable`,
            ).toBe(TENANT_A);
        }
    });

    it('never accepts a tenantId supplied by the caller', async () => {
        queries.length = 0;
        await app.inject({
            method: 'GET',
            url: '/bookings',
            query: { tenantId: TENANT_B },
            headers: { 'x-test-tenant': TENANT_A },
        });

        for (const q of scopedQueries('booking')) {
            const where = q.args?.where ?? {};
            expect(
                where.tenantId,
                'a tenantId from the query string reached the database',
            ).not.toBe(TENANT_B);
        }
    });

    it('scopes conversations to the caller tenant', async () => {
        queries.length = 0;
        await app.inject({ method: 'GET', url: '/conversations', headers: { 'x-test-tenant': TENANT_A } });

        const reads = scopedQueries('conversation').filter((q) => q.op.startsWith('find'));
        expect(reads.length).toBeGreaterThan(0);
        for (const q of reads) {
            expect(q.args?.where?.tenantId).toBe(TENANT_A);
        }
    });

    it('scopes services to the caller tenant', async () => {
        queries.length = 0;
        await app.inject({ method: 'GET', url: '/services', headers: { 'x-test-tenant': TENANT_A } });

        const reads = scopedQueries('service').filter((q) => q.op.startsWith('find'));
        expect(reads.length).toBeGreaterThan(0);
        for (const q of reads) {
            expect(q.args?.where?.tenantId).toBe(TENANT_A);
        }
    });
});

describe('authentication is required', () => {
    it('rejects unauthenticated requests to tenant data', async () => {
        for (const url of ['/bookings', '/conversations', '/services', '/customers']) {
            const res = await app.inject({ method: 'GET', url }); // no x-test-tenant
            expect(res.statusCode, `${url} served data without authentication`).toBe(401);
        }
    });
});

describe('validation returns 400, not 500', () => {
    it('reports a malformed body as a client error', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/auth/login',
            payload: { email: 'not-an-email', password: '' },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.error).toBe('Bad Request');
        // The schema itself must not be published to callers.
        expect(JSON.stringify(body)).not.toContain('invalid_string');
    });
});
