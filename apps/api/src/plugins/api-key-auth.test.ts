import { describe, it, expect, vi, afterEach } from 'vitest';
import apiKeyAuth from './api-key-auth.js';
import { buildHarness, type Harness } from '../test-utils/api-harness.js';
import { getTenantContext } from '../lib/tenant-context.js';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());

let h: Harness;
afterEach(async () => { await h?.close(); });

async function build(opts: Record<string, unknown> = {}) {
    h = await buildHarness(async (app) => {
        await app.register(apiKeyAuth, opts);
        // CONFIG: rateLimit false mirrors what every v1 route sets, so the
        // per-key limiter in the plugin is the one that runs.
        const cfg = { config: { rateLimit: false as const } };
        app.get('/whoami', { ...cfg, preHandler: app.authenticateApiKey(['messages:write']) }, async (req) => ({
            tenantId: req.apiKey!.tenantId,
            prefix: req.apiKey!.prefix,
            ctx: getTenantContext(),
        }));
        app.get('/needs-two', { ...cfg, preHandler: app.authenticateApiKey(['messages:write', 'customers:read']) }, async () => ({ ok: true }));
        app.get('/unscoped', { ...cfg, preHandler: app.authenticateApiKey([]) }, async (req) => {
            const rows = await (app as any).prisma.conversation.findMany({ where: req.query as any });
            return { rows };
        });
    });
    return h;
}

const bearer = (k: string) => ({ authorization: `Bearer ${k}` });

describe('authenticateApiKey', () => {
    it('accepts a valid key, exposes request.apiKey and binds the tenant context', async () => {
        await build();
        const key = h.makeKey({ tenantId: 'tenant-a', scopes: ['messages:write'] });
        const res = await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(key) });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.tenantId).toBe('tenant-a');
        expect(body.ctx).toEqual({ tenantId: 'tenant-a' });
    });

    it('returns the same generic 401 for missing, malformed, unknown, wrong-secret and revoked keys', async () => {
        await build();
        const good = h.makeKey();
        const revoked = h.makeKey({ revoked: true });
        const wrongSecret = good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a');
        const cases: Array<Record<string, string>> = [
            {},
            { authorization: 'Basic abc' },
            { authorization: 'Bearer' },
            { authorization: 'Bearer not-a-key' },
            { authorization: `Bearer bk_live_zzzzzzzzzz_${'a'.repeat(48)}` },
            bearer(wrongSecret),
            bearer(revoked),
        ];
        const bodies = new Set<string>();
        for (const headers of cases) {
            const res = await h.app.inject({ method: 'GET', url: '/whoami', headers });
            expect(res.statusCode).toBe(401);
            bodies.add(res.body);
        }
        // No oracle: every failure reads identically.
        expect(bodies.size).toBe(1);
        expect(h.find('conversation', 'findMany')).toHaveLength(0);
    });

    it('rejects a key whose tenant is switched off', async () => {
        await build();
        const key = h.makeKey();
        h.respond('tenant.findUnique', { id: 'tenant-a', isActive: false });
        const res = await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(key) });
        expect(res.statusCode).toBe(401);
    });

    it('returns 403 when a required scope is missing, naming the scope', async () => {
        await build();
        const key = h.makeKey({ scopes: ['messages:write'] });
        const res = await h.app.inject({ method: 'GET', url: '/needs-two', headers: bearer(key) });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toContain('customers:read');
    });

    it('lets the tenant guard apply: an unscoped query is blocked, a scoped one passes', async () => {
        await build();
        const key = h.makeKey({ tenantId: 'tenant-a' });

        const bad = await h.app.inject({ method: 'GET', url: '/unscoped', headers: bearer(key) });
        expect(bad.statusCode).toBe(500);
        expect(h.violations).toHaveLength(1);

        const ok = await h.app.inject({ method: 'GET', url: '/unscoped?tenantId=tenant-a', headers: bearer(key) });
        expect(ok.statusCode).toBe(200);
        expect(h.violations).toHaveLength(1);
    });

    it('records lastUsedAt through a tenant-scoped, throttled write', async () => {
        await build();
        const key = h.makeKey({ tenantId: 'tenant-a' });
        await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(key) });
        const upd = h.find('apiKey', 'updateMany');
        expect(upd).toHaveLength(1);
        expect(upd[0].args.where.tenantId).toBe('tenant-a');
        expect(h.violations).toHaveLength(0);
    });

    it('still serves the request when the lastUsedAt write fails', async () => {
        await build();
        const key = h.makeKey();
        h.respond('apiKey.updateMany', () => { throw new Error('db blip'); });
        const res = await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(key) });
        expect(res.statusCode).toBe(200);
    });

    it('rate limits per key; a different key is unaffected', async () => {
        await build({ perKeyLimit: 3 });
        const a = h.makeKey({ tenantId: 'tenant-a' });
        const b = h.makeKey({ tenantId: 'tenant-b' });
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) codes.push((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(a) })).statusCode);
        expect(codes).toEqual([200, 200, 200, 429, 429]);
        expect((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(b) })).statusCode).toBe(200);
    });

    it('does not let bad-secret probes on a known prefix burn the real key\'s quota', async () => {
        await build({ perKeyLimit: 2, failureLimit: 1000 });
        const key = h.makeKey();
        const forged = key.slice(0, -1) + (key.endsWith('a') ? 'b' : 'a');
        for (let i = 0; i < 10; i++) await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(forged) });
        expect((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(key) })).statusCode).toBe(200);
    });

    it('throttles repeated authentication failures from one address', async () => {
        await build({ failureLimit: 3 });
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) codes.push((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer('bk_live_aaaaaaaaaa_' + 'b'.repeat(48)) })).statusCode);
        expect(codes).toEqual([401, 401, 401, 429, 429]);
    });

    it('one bad caller cannot lock out valid keys: the failure bucket is per address AND key prefix', async () => {
        await build({ failureLimit: 3 });
        const valid = h.makeKey({ tenantId: 'tenant-a' });
        const bad = 'bk_live_aaaaaaaaaa_' + 'b'.repeat(48);
        for (let i = 0; i < 6; i++) await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(bad) });
        expect((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(bad) })).statusCode).toBe(429);
        // Same address, different (valid) key: still served.
        expect((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(valid) })).statusCode).toBe(200);
    });

    it('a blocked address is rejected before verification, so a blocked bucket costs no DB lookup', async () => {
        await build({ failureLimit: 2 });
        const bad = 'bk_live_aaaaaaaaaa_' + 'b'.repeat(48);
        for (let i = 0; i < 2; i++) await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(bad) });
        const before = h.queries.filter((q) => q.model === 'apiKey').length;
        expect((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(bad) })).statusCode).toBe(429);
        expect(h.queries.filter((q) => q.model === 'apiKey').length).toBe(before);
    });

    it('rotating the prefix does not evade a flood bound per address', async () => {
        await build({ failureLimit: 100, ipFailureLimit: 5 });
        const codes: number[] = [];
        for (let i = 0; i < 7; i++) {
            const prefix = 'aaaaaaaa' + String(10 + i);
            codes.push((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(`bk_live_${prefix}_${'b'.repeat(48)}`) })).statusCode);
        }
        expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429]);
    });

    it('successful requests never count as failures', async () => {
        await build({ failureLimit: 2, ipFailureLimit: 2 });
        const key = h.makeKey();
        for (let i = 0; i < 10; i++) {
            expect((await h.app.inject({ method: 'GET', url: '/whoami', headers: bearer(key) })).statusCode).toBe(200);
        }
    });
});
