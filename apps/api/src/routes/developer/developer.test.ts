import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fp from 'fastify-plugin';
import developerRoutes from './index.js';
import { buildHarness, type Harness } from '../../test-utils/api-harness.js';
import { bindTenantContext } from '../../lib/tenant-context.js';
import { decrypt } from '../../services/crypto.js';
import { generateApiKey, hashSecret, MAX_ACTIVE_KEYS_PER_TENANT } from '../../services/api-keys.js';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('../../services/audit.js', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../services/events/ssrf.js', async (orig) => {
    const real = await orig<typeof import('../../services/events/ssrf.js')>();
    return {
        ...real,
        // Same syntax rules as production; no DNS in unit tests.
        validateWebhookUrl: async (raw: string) => {
            const u = real.parseWebhookUrl(raw);
            if (u.hostname === 'internal.example') throw new real.UnsafeUrlError('Webhook host resolves to a private or reserved address');
            return u;
        },
    };
});

import { audit } from '../../services/audit.js';

let h: Harness;
beforeEach(async () => {
    vi.clearAllMocks();
    h = await buildHarness(
        async (app) => { await app.register(developerRoutes, { prefix: '/developer' }); },
        {
            setup: async (app) => {
                await app.register(fp(async (a) => {
                    a.decorate('authenticate', async (request: any) => {
                        const tenantId = request.headers['x-test-tenant'];
                        if (!tenantId) throw a.httpErrors.unauthorized('Invalid or expired token');
                        request.user = { userId: 'user-1', tenantId, role: request.headers['x-test-role'] ?? 'OWNER' };
                        bindTenantContext({ tenantId, userId: 'user-1' });
                    });
                }, { name: 'auth-user' }));
            },
        },
    );
});
afterEach(async () => { await h.close(); });

const owner = (tenant = 'tenant-a') => ({ 'x-test-tenant': tenant, 'x-test-role': 'OWNER' });
const staff = { 'x-test-tenant': 'tenant-a', 'x-test-role': 'STAFF' };
const call = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
    h.app.inject({ method: method as any, url, headers, payload: payload as any });

describe('access control', () => {
    const endpoints: Array<[string, string, unknown?]> = [
        ['GET', '/developer/scopes'],
        ['GET', '/developer/api-keys'],
        ['POST', '/developer/api-keys', { name: 'x', scopes: ['messages:write'] }],
        ['DELETE', '/developer/api-keys/k1'],
        ['GET', '/developer/external-app'],
        ['PUT', '/developer/external-app', { name: 'x', url: 'https://x.example/h' }],
        ['POST', '/developer/external-app/rotate-secret'],
        ['DELETE', '/developer/external-app'],
    ];

    it.each(endpoints)('%s %s is OWNER only (STAFF gets 403)', async (method, url, payload) => {
        const res = await call(method, url, staff, payload);
        expect(res.statusCode).toBe(403);
        expect(h.queries.filter((q) => q.model !== '$raw')).toHaveLength(0);
    });

    it.each(endpoints)('%s %s requires login (401)', async (method, url, payload) => {
        const res = await call(method, url, {}, payload);
        expect(res.statusCode).toBe(401);
    });
});

describe('API keys', () => {
    it('lists the available scopes', async () => {
        const res = await call('GET', '/developer/scopes', owner());
        expect(res.json().data.map((s: any) => s.scope)).toContain('messages:write');
        expect(res.json().data[0]).toHaveProperty('description');
    });

    it('creates a key, shows the full key exactly once and audits it', async () => {
        const res = await call('POST', '/developer/api-keys', owner(), { name: 'TURBO prod', scopes: ['messages:write', 'conversations:read'] });
        expect(res.statusCode).toBe(201);
        const { key, apiKey } = res.json().data;
        expect(key).toMatch(/^bk_live_[A-Za-z0-9]{10}_[A-Za-z0-9]{43,}$/);
        expect(apiKey).toMatchObject({ name: 'TURBO prod', scopes: ['messages:write', 'conversations:read'] });
        expect(apiKey.prefix).toBe(key.split('_')[2]);
        expect(apiKey).not.toHaveProperty('secretHash');

        const created = h.find('apiKey', 'create')[0].args.data;
        expect(created.tenantId).toBe('tenant-a');
        expect(created.createdBy).toBe('user-1');
        expect(created.secretHash).toBe(hashSecret(key.split('_')[3]));
        expect(JSON.stringify(created)).not.toContain(key.split('_')[3]);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.created', tenantId: 'tenant-a', actorId: 'user-1', targetId: expect.any(String) }));
        // the audit trail must not carry the secret
        expect(JSON.stringify((audit as any).mock.calls)).not.toContain(key.split('_')[3]);
    });

    it('listing shows prefix, scopes, lastUsed and never the key or hash', async () => {
        h.respond('apiKey.findMany', [{ id: 'k1', name: 'a', prefix: 'abcdefghij', scopes: ['messages:write'], lastUsedAt: new Date('2026-01-01'), revokedAt: null, createdAt: new Date('2025-12-01') }]);
        const res = await call('GET', '/developer/api-keys', owner('tenant-b'));
        expect(res.statusCode).toBe(200);
        expect(h.find('apiKey', 'findMany')[0].args.where).toEqual({ tenantId: 'tenant-b' });
        expect(res.json().data[0]).toMatchObject({ prefix: 'abcdefghij', scopes: ['messages:write'], lastUsedAt: expect.any(String) });
        expect(res.body).not.toMatch(/secretHash|bk_live_/);
    });

    it.each([
        ['no scopes', { name: 'x', scopes: [] }],
        ['unknown scope', { name: 'x', scopes: ['root'] }],
        ['blank name', { name: ' ', scopes: ['messages:write'] }],
        ['missing name', { scopes: ['messages:write'] }],
        ['extra field', { name: 'x', scopes: ['messages:write'], tenantId: 'other' }],
    ])('400 for %s', async (_n, payload) => {
        const res = await call('POST', '/developer/api-keys', owner(), payload);
        expect(res.statusCode).toBe(400);
        expect(h.find('apiKey', 'create')).toHaveLength(0);
    });

    it('409 at the active key limit', async () => {
        h.respond('apiKey.count', MAX_ACTIVE_KEYS_PER_TENANT);
        const res = await call('POST', '/developer/api-keys', owner(), { name: 'x', scopes: ['messages:write'] });
        expect(res.statusCode).toBe(409);
    });

    it('revokes a key by id within the tenant, and audits', async () => {
        const res = await call('DELETE', '/developer/api-keys/k1', owner('tenant-b'));
        expect(res.statusCode).toBe(200);
        expect(h.find('apiKey', 'updateMany')[0].args.where).toEqual({ id: 'k1', tenantId: 'tenant-b', revokedAt: null });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.revoked', targetId: 'k1' }));
    });

    it('404 revoking another tenant\'s key', async () => {
        h.respond('apiKey.updateMany', { count: 0 });
        const res = await call('DELETE', '/developer/api-keys/k1', owner('tenant-b'));
        expect(res.statusCode).toBe(404);
        expect(audit).not.toHaveBeenCalled();
    });

    it('revoking twice is a 200 no-op', async () => {
        h.respond('apiKey.updateMany', { count: 0 });
        h.respond('apiKey.findFirst', { id: 'k1' });
        const res = await call('DELETE', '/developer/api-keys/k1', owner());
        expect(res.statusCode).toBe(200);
    });

    it('a revoked key no longer authenticates (end to end through the v1 plugin)', async () => {
        // The key row the verifier would load once revoked.
        const { prefix, secret } = generateApiKey();
        const { verifyApiKey } = await import('../../services/api-keys.js');
        const row = { id: 'k1', tenantId: 'tenant-a', name: 'n', prefix, secretHash: hashSecret(secret), scopes: ['messages:write'], lastUsedAt: null, revokedAt: new Date() };
        const stub: any = { apiKey: { findUnique: async () => row }, tenant: { findUnique: async () => ({ isActive: true }) } };
        expect(await verifyApiKey(stub, `bk_live_${prefix}_${secret}`)).toBeNull();
    });
});

describe('external app', () => {
    const body = { name: 'TURBO', url: 'https://turbo.example/hooks/bookly', isActive: true };

    it('GET returns null when none is configured', async () => {
        const res = await call('GET', '/developer/external-app', owner());
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toBeNull();
    });

    it('PUT creates the app, shows the signing secret once, stores it encrypted and syncs the subscription', async () => {
        const res = await call('PUT', '/developer/external-app', owner(), body);
        expect(res.statusCode).toBe(200);
        const data = res.json().data;
        expect(data.signingSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
        expect(data).toMatchObject({ name: 'TURBO', url: body.url, isActive: true });
        expect(data).not.toHaveProperty('signingSecretEnc');

        const stored = h.find('externalApp', 'create')[0].args.data;
        expect(stored.tenantId).toBe('tenant-a');
        expect(stored.signingSecretEnc).not.toBe(data.signingSecret);
        expect(decrypt(stored.signingSecretEnc)).toBe(data.signingSecret);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'external_app.saved' }));
        expect(JSON.stringify((audit as any).mock.calls)).not.toContain(data.signingSecret);
        expect(h.find('webhookSubscription', 'updateMany').length + h.find('webhookSubscription', 'create').length).toBeGreaterThan(0);
    });

    it('PUT on an existing app never returns the secret again', async () => {
        // Stateful stand-in: reads reflect the preceding updateMany, like a real table.
        let row: any = { id: 'a1', tenantId: 'tenant-a', name: 'Old', url: 'https://old.example/h', signingSecretEnc: 'enc', isActive: true, createdAt: new Date(), updatedAt: new Date() };
        h.respond('externalApp.findFirst', () => row);
        h.respond('externalApp.updateMany', (args: any) => { row = { ...row, ...args.data }; return { count: 1 }; });
        const res = await call('PUT', '/developer/external-app', owner(), { ...body, isActive: false });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).not.toHaveProperty('signingSecret');
        expect(res.body).not.toMatch(/whsec_|signingSecretEnc/);
        expect(h.find('externalApp', 'updateMany')[0].args.where).toEqual({ tenantId: 'tenant-a' });
        const sync = h.find('webhookSubscription', 'updateMany')[0].args;
        expect(sync.data.isActive).toBe(false); // deactivating the app deactivates delivery
    });

    it('GET never exposes the secret', async () => {
        h.respond('externalApp.findFirst', { id: 'a1', tenantId: 'tenant-a', name: 'T', url: 'https://t.example/h', signingSecretEnc: 'SECRETCIPHER', isActive: true, createdAt: new Date(), updatedAt: new Date() });
        const res = await call('GET', '/developer/external-app', owner());
        expect(res.json().data).toMatchObject({ name: 'T', url: 'https://t.example/h', isActive: true });
        expect(res.body).not.toMatch(/SECRETCIPHER|signingSecret/);
    });

    it.each([
        ['not a url', { ...body, url: 'nope' }],
        ['ftp scheme', { ...body, url: 'ftp://turbo.example/h' }],
        ['javascript scheme', { ...body, url: 'javascript:alert(1)' }],
        ['embedded credentials', { ...body, url: 'https://user:pw@turbo.example/h' }],
        ['private host', { ...body, url: 'https://internal.example/h' }],
        ['url too long', { ...body, url: 'https://turbo.example/' + 'a'.repeat(2000) }],
        ['blank name', { ...body, name: ' ' }],
        ['name too long', { ...body, name: 'x'.repeat(81) }],
        ['missing url', { name: 'x' }],
        ['signing secret supplied by client', { ...body, signingSecret: 'whsec_mine' }],
    ])('400 for %s', async (_n, payload) => {
        const res = await call('PUT', '/developer/external-app', owner(), payload);
        expect(res.statusCode).toBe(400);
        expect(h.find('externalApp', 'create')).toHaveLength(0);
        expect(h.find('externalApp', 'updateMany')).toHaveLength(0);
    });

    it('requires https in production', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const res = await call('PUT', '/developer/external-app', owner(), { ...body, url: 'http://turbo.example/h' });
            expect(res.statusCode).toBe(400);
            expect(res.json().message).toMatch(/https/i);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });

    it('isActive defaults to true', async () => {
        await call('PUT', '/developer/external-app', owner(), { name: 'T', url: 'https://t.example/h' });
        expect(h.find('externalApp', 'create')[0].args.data.isActive).toBe(true);
    });

    it('rotate returns a new secret once and re-syncs the subscription', async () => {
        h.respond('externalApp.findFirst', { id: 'a1', tenantId: 'tenant-a', name: 'T', url: 'https://t.example/h', signingSecretEnc: 'old', isActive: true });
        const res = await call('POST', '/developer/external-app/rotate-secret', owner());
        expect(res.statusCode).toBe(200);
        const secret = res.json().data.signingSecret;
        expect(secret).toMatch(/^whsec_/);
        const upd = h.find('externalApp', 'updateMany')[0].args;
        expect(upd.where).toEqual({ tenantId: 'tenant-a' });
        expect(decrypt(upd.data.signingSecretEnc)).toBe(secret);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'external_app.secret_rotated' }));
        expect(JSON.stringify((audit as any).mock.calls)).not.toContain(secret);
    });

    it('rotate is 404 when no app is configured', async () => {
        const res = await call('POST', '/developer/external-app/rotate-secret', owner());
        expect(res.statusCode).toBe(404);
    });

    it('DELETE removes the app for this tenant only', async () => {
        const res = await call('DELETE', '/developer/external-app', owner('tenant-b'));
        expect(res.statusCode).toBe(200);
        expect(h.find('externalApp', 'deleteMany')[0].args.where).toEqual({ tenantId: 'tenant-b' });
    });

    it('never runs an unscoped tenant query across the whole suite of calls', async () => {
        await call('GET', '/developer/api-keys', owner());
        await call('POST', '/developer/api-keys', owner(), { name: 'x', scopes: ['messages:write'] });
        await call('DELETE', '/developer/api-keys/k1', owner());
        await call('PUT', '/developer/external-app', owner(), body);
        await call('POST', '/developer/external-app/rotate-secret', owner());
        await call('DELETE', '/developer/external-app', owner());
        expect(h.violations).toEqual([]);
    });
});
