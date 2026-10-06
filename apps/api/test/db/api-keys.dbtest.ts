/**
 * API key rotation and expiry on real Postgres, through the REAL api-key-auth
 * plugin and the REAL tenant-guarded Prisma client (plugins/prisma.ts).
 *
 * Proves: a rotated key keeps working through its grace period while the
 * replacement works too; once expiresAt passes the old key is refused with the
 * same 401 as a revoked key and a deduped PlatformAlert is recorded; the
 * tenant guard is live for API-key traffic the whole time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import prismaPlugin from '../../src/plugins/prisma.js';
import errorHandler from '../../src/plugins/error-handler.js';
import apiKeyAuth from '../../src/plugins/api-key-auth.js';
import { tenantContext, tenantContextOnRequest } from '../../src/lib/tenant-context.js';
import { createApiKey, rotateApiKey, revokeApiKey } from '../../src/services/api-keys.js';
import { rawPrisma } from './helpers/db.js';
import { seedTenant } from './helpers/seed.js';

let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
    const f = Fastify({ logger: false });
    await f.register(sensible);
    await f.register(errorHandler);
    await f.register(prismaPlugin);
    // Stand-in for plugins/auth.ts: it owns the per-request tenant-context store.
    await f.register(fp(async (a) => { a.addHook('onRequest', tenantContextOnRequest); }, { name: 'auth' }));
    await f.register(apiKeyAuth);
    const cfg = { config: { rateLimit: false as const } };
    f.get('/scoped', { ...cfg, preHandler: f.authenticateApiKey(['customers:read']) }, async (req) => ({
        tenantId: req.apiKey!.tenantId,
        customers: await f.prisma.customer.count({ where: { tenantId: req.apiKey!.tenantId } }),
    }));
    f.get('/unscoped', { ...cfg, preHandler: f.authenticateApiKey(['customers:read']) }, async () => ({
        customers: await f.prisma.customer.count(),
    }));
    await f.ready();
    return f;
}

beforeEach(async () => { app = await buildApp(); });
afterEach(async () => { await app.close(); });

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const get = (url: string, key: string) => app.inject({ method: 'GET', url, headers: bearer(key) });

/** Service calls the dashboard makes run inside the owner's tenant context, guard live. */
const asTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    tenantContext.run({ tenantId, userId: 'owner-1' }, async () => await fn());

describe('API key rotation on the real engine', () => {
    it('old and new keys both work during the grace period; the old one is refused once it expires', async () => {
        const tenant = await seedTenant();
        const prisma = app.prisma;
        const { key: oldKey, apiKey: oldRow } = await asTenant(tenant.id, () =>
            createApiKey(prisma, { tenantId: tenant.id, name: 'TURBO prod', scopes: ['customers:read'] }));

        expect((await get('/scoped', oldKey)).statusCode).toBe(200);

        const rotated = await asTenant(tenant.id, () =>
            rotateApiKey(prisma, { tenantId: tenant.id, id: oldRow.id, graceHours: 1, createdBy: 'owner-1' }));
        expect(rotated.apiKey).toMatchObject({ name: 'TURBO prod', scopes: ['customers:read'], rotatedFromId: oldRow.id, status: 'active' });

        // Grace: both keys work, and both are bound to the right tenant.
        const viaOld = await get('/scoped', oldKey);
        const viaNew = await get('/scoped', rotated.key);
        expect(viaOld.statusCode).toBe(200);
        expect(viaNew.statusCode).toBe(200);
        expect(viaOld.json().tenantId).toBe(tenant.id);
        expect(viaNew.json().tenantId).toBe(tenant.id);

        const stored = await rawPrisma().apiKey.findUniqueOrThrow({ where: { id: oldRow.id } });
        expect(stored.revokedAt).toBeNull();
        expect(stored.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);

        // Time passes: the grace period is over.
        await rawPrisma().apiKey.update({ where: { id: oldRow.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

        const expired = await get('/scoped', oldKey);
        expect(expired.statusCode).toBe(401);
        const revokedKey = await asTenant(tenant.id, () =>
            createApiKey(prisma, { tenantId: tenant.id, name: 'other', scopes: ['customers:read'] }));
        await asTenant(tenant.id, () => revokeApiKey(prisma, tenant.id, revokedKey.apiKey.id));
        const revoked = await get('/scoped', revokedKey.key);
        expect(revoked.statusCode).toBe(401);
        expect(expired.body).toBe(revoked.body); // no oracle between expired and revoked

        expect((await get('/scoped', rotated.key)).statusCode).toBe(200);

        // A leaked expired key being tried is visible, once per key per day.
        await get('/scoped', oldKey);
        const alerts = await rawPrisma().platformAlert.findMany({ where: { kind: 'api_key.revoked_used', tenantId: tenant.id }, orderBy: { firstSeenAt: 'asc' } });
        const forOld = alerts.find((a) => (a.context as any)?.apiKeyId === oldRow.id)!;
        expect(forOld).toBeTruthy();
        expect(forOld.count).toBe(2);
        expect(forOld.severity).toBe('warning');
        expect(JSON.stringify(alerts)).not.toContain(oldKey.split('_')[3]);
    });

    it('the tenant guard is live for API key traffic: an unscoped query is refused', async () => {
        const tenant = await seedTenant();
        const { key } = await asTenant(tenant.id, () =>
            createApiKey(app.prisma, { tenantId: tenant.id, name: 'k', scopes: ['customers:read'] }));
        expect((await get('/scoped', key)).statusCode).toBe(200);
        expect((await get('/unscoped', key)).statusCode).toBe(500);
    });

    it('a key from one tenant cannot rotate or touch another tenant\'s key', async () => {
        const a = await seedTenant();
        const b = await seedTenant();
        const { apiKey: bKey } = await asTenant(b.id, () => createApiKey(app.prisma, { tenantId: b.id, name: 'b', scopes: ['customers:read'] }));
        await expect(asTenant(a.id, () => rotateApiKey(app.prisma, { tenantId: a.id, id: bKey.id, graceHours: 24 })))
            .rejects.toMatchObject({ code: 'not_found' });
        const row = await rawPrisma().apiKey.findUniqueOrThrow({ where: { id: bKey.id } });
        expect(row.expiresAt).toBeNull();
        expect(await rawPrisma().apiKey.count({ where: { tenantId: a.id } })).toBe(0);
    });

    it('grace 0 revokes the old key immediately; a second rotate of the same key is refused', async () => {
        const tenant = await seedTenant();
        const { key: oldKey, apiKey } = await asTenant(tenant.id, () =>
            createApiKey(app.prisma, { tenantId: tenant.id, name: 'k', scopes: ['customers:read'] }));
        const r = await asTenant(tenant.id, () => rotateApiKey(app.prisma, { tenantId: tenant.id, id: apiKey.id, graceHours: 0 }));
        expect((await get('/scoped', oldKey)).statusCode).toBe(401);
        expect((await get('/scoped', r.key)).statusCode).toBe(200);
        await expect(asTenant(tenant.id, () => rotateApiKey(app.prisma, { tenantId: tenant.id, id: apiKey.id, graceHours: 24 })))
            .rejects.toMatchObject({ code: 'not_active' });
    });
});
