import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import { clearTenantActiveCache } from '../services/tenant-active.js';

/**
 * REAL plugins/auth.ts: a deactivated (or deleted) organisation's staff are
 * refused even with an access token issued before the deactivation.
 */

let app: FastifyInstance;
const tenants = new Map<string, { isActive: boolean }>();
const findUnique = vi.fn(async ({ where }: any) => tenants.get(where.id) ?? null);

beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation-x';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-long-enough-for-validation';
    process.env.ADMIN_JWT_SECRET ??= 'test-admin-secret-long-enough-for-validation-x';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    const { default: authPlugin } = await import('./auth.js');
    const { default: errorHandler } = await import('./error-handler.js');
    app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(errorHandler as any);
    await app.register(fp(async (a) => { a.decorate('prisma', { tenant: { findUnique } } as never); }, { name: 'prisma' }));
    await app.register(authPlugin as any);
    app.get('/bookings', { preHandler: [app.authenticate] }, async (request: any) => ({ tenantId: request.user.tenantId }));
    await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { clearTenantActiveCache(); tenants.clear(); findUnique.mockClear(); });

const token = (tenantId: string) => app.jwt.sign({ userId: 'u1', tenantId, role: 'OWNER', type: 'access' });
const get = (tenantId: string) => app.inject({ method: 'GET', url: '/bookings', headers: { authorization: `Bearer ${token(tenantId)}` } });

describe('authenticate and the organisation being active', () => {
    it('an active organisation passes', async () => {
        tenants.set('t1', { isActive: true });
        const res = await get('t1');
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ tenantId: 't1' });
    });

    it('a deactivated organisation is refused with 401 even with a valid access token', async () => {
        tenants.set('t1', { isActive: false });
        const res = await get('t1');
        expect(res.statusCode).toBe(401);
        expect(res.json().message).toMatch(/disabled/i);
    });

    it('a deleted organisation is refused with 401', async () => {
        expect((await get('gone')).statusCode).toBe(401);
    });

    it('reads the organisation without a tenant filter problem (before the tenant context is bound)', async () => {
        tenants.set('t1', { isActive: true });
        await get('t1');
        expect(findUnique).toHaveBeenCalledWith({ where: { id: 't1' }, select: { isActive: true } });
    });
});
