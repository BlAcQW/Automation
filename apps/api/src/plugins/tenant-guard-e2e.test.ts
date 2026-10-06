import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import { getTenantContext } from '../lib/tenant-context.js';

/**
 * End to end through the REAL plugins/auth.ts (signed JWT) and the REAL guard
 * (runGuardedQuery, block mode). Only the database engine is replaced: the
 * stub `query` stands in for Prisma's own executor, so it records whether the
 * guard let a query through.
 */

const TENANT = 'tenant-aaa';
const SECRET_ROW = { id: 'b-other', customerName: 'OTHER-TENANTS-CUSTOMER' };

let app: FastifyInstance;
const executed: Array<{ model: string; operation: string; where: unknown }> = [];

beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation-x';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-long-enough-for-validation';
    process.env.ADMIN_JWT_SECRET ??= 'test-admin-secret-long-enough-for-validation-x';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    const { runGuardedQuery } = await import('./prisma.js');
    const { default: authPlugin } = await import('./auth.js');
    const { default: errorHandler } = await import('./error-handler.js');

    const guarded = (model: string, operation: string) => (args: { where?: unknown }) =>
        runGuardedQuery(
            {
                model,
                operation,
                args,
                query: async (a: { where?: unknown }) => {
                    executed.push({ model, operation, where: a.where });
                    return [SECRET_ROW];
                },
            },
            'block',
            () => undefined,
        );

    app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(errorHandler as any);
    await app.register(
        fp(async (a) => {
            a.decorate('prisma', {
                booking: { findMany: guarded('Booking', 'findMany') },
                admin: { findUnique: async () => ({ id: 'adm', isSuperAdmin: true, isActive: true }) },
            } as never);
        }, { name: 'prisma' }),
    );
    await app.register(authPlugin as any);

    app.get('/ctx', { preHandler: [app.authenticate] }, async () => ({
        ctx: getTenantContext() ?? null,
    }));
    app.get('/scoped', { preHandler: [app.authenticate] }, async (request) =>
        (app.prisma as any).booking.findMany({ where: { tenantId: request.user.tenantId } }),
    );
    app.get('/unscoped', { preHandler: [app.authenticate] }, async () =>
        (app.prisma as any).booking.findMany({ where: { id: 'b-other' } }),
    );
    // Webhook / public style: no authenticate, legitimately cross-tenant.
    app.post('/webhook', async () => ({
        ctx: getTenantContext() ?? null,
        rows: await (app.prisma as any).booking.findMany({ where: { id: 'b-other' } }),
    }));
    app.get('/admin-all', { preHandler: [app.authenticateAdmin] }, async () =>
        (app.prisma as any).booking.findMany({ where: {} }),
    );
    await app.ready();
});

afterAll(async () => {
    await app?.close();
});

function userToken(tenantId = TENANT) {
    return app.jwt.sign({ userId: 'user-1', tenantId, role: 'OWNER', type: 'access' });
}
function auth(tenantId?: string) {
    return { authorization: `Bearer ${userToken(tenantId)}` };
}

describe('tenant guard through the real auth plugin', () => {
    it('a signed JWT puts the tenant in context inside the handler', async () => {
        const res = await app.inject({ url: '/ctx', headers: auth() });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ctx: { tenantId: TENANT, userId: 'user-1' } });
    });

    it('lets a tenant-scoped query through', async () => {
        executed.length = 0;
        const res = await app.inject({ url: '/scoped', headers: auth() });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([SECRET_ROW]);
        expect(executed).toEqual([{ model: 'Booking', operation: 'findMany', where: { tenantId: TENANT } }]);
    });

    it('blocks an unscoped guarded query: generic 500, nothing executed, nothing leaked', async () => {
        executed.length = 0;
        const res = await app.inject({ url: '/unscoped', headers: auth() });
        expect(res.statusCode).toBe(500);
        expect(executed).toHaveLength(0);
        expect(res.body).not.toContain('OTHER-TENANTS-CUSTOMER');
        expect(res.body).not.toContain('Tenant guard');
        expect(res.body).not.toContain('Booking');
        expect(res.json()).toMatchObject({
            statusCode: 500,
            message: 'Something went wrong on our side. Please try again.',
        });
    });

    it('does not leak one request tenant into the next or into concurrent requests', async () => {
        const [a, b] = await Promise.all([
            app.inject({ url: '/ctx', headers: auth('tenant-a') }),
            app.inject({ url: '/ctx', headers: auth('tenant-b') }),
        ]);
        expect(a.json().ctx.tenantId).toBe('tenant-a');
        expect(b.json().ctx.tenantId).toBe('tenant-b');
        const anon = await app.inject({ method: 'POST', url: '/webhook' });
        expect(anon.json().ctx).toEqual({});
    });

    it('a webhook-style unauthenticated request has no tenant and is unaffected', async () => {
        executed.length = 0;
        const res = await app.inject({ method: 'POST', url: '/webhook' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ctx: {}, rows: [SECRET_ROW] });
        expect(executed).toHaveLength(1);
    });

    it('rejects a bad token before any query runs', async () => {
        executed.length = 0;
        const res = await app.inject({ url: '/unscoped', headers: { authorization: 'Bearer nope' } });
        expect(res.statusCode).toBe(401);
        expect(executed).toHaveLength(0);
    });

    it('admin context stays cross-tenant (unguarded)', async () => {
        const token = (app as any).jwt.admin.sign({ adminId: 'adm', type: 'admin_access' });
        const res = await app.inject({ url: '/admin-all', headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode).toBe(200);
    });
});

describe('TENANT_GUARD_MODE=warn is the rollback', () => {
    it('lets the unscoped query run and logs model/operation/tenant only', async () => {
        const { runGuardedQuery } = await import('./prisma.js');
        const { tenantContext } = await import('../lib/tenant-context.js');
        const log = vi.fn();
        const query = vi.fn(async () => 'ran');
        const out = await tenantContext.run({ tenantId: TENANT, userId: 'u' }, () =>
            runGuardedQuery(
                { model: 'Booking', operation: 'findMany', args: { where: { id: 'secret-id' } }, query },
                'warn',
                log,
            ),
        );
        expect(out).toBe('ran');
        expect(query).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith({
            msg: 'cross_tenant_query_attempt',
            cross_tenant_query_attempt: true,
            blocked: false,
            model: 'Booking',
            operation: 'findMany',
            contextTenantId: TENANT,
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret-id');
    });
});
