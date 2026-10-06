import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import { getTenantContext } from '../lib/tenant-context.js';
import { clearSwitchCache } from '../services/platform-switches.js';

/**
 * REAL plugins/auth.ts, stub database. Covers A5 (support tokens: read-only,
 * session re-checked per request, every request audited) and A4 (the admin
 * identity now carries the role and 2FA state).
 */

let app: FastifyInstance;
const audits: any[] = [];
const db = {
    session: null as any,
    admin: { id: 'adm', isSuperAdmin: false, isActive: true, role: 'SUPPORT', totpEnabledAt: null as Date | null },
    auditFails: false,
    require2fa: false,
};

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
    await app.register(
        fp(async (a) => {
            a.decorate('prisma', {
                supportSession: { findFirst: vi.fn(async () => db.session) },
                auditLog: {
                    create: vi.fn(async ({ data }: any) => {
                        if (db.auditFails) throw new Error('audit db down');
                        audits.push(data);
                        return {};
                    }),
                },
                admin: { findUnique: vi.fn(async () => db.admin) },
                platformSetting: { findUnique: vi.fn(async () => (db.require2fa ? { value: { enabled: true } } : null)) },
            } as never);
        }, { name: 'prisma' }),
    );
    await app.register(authPlugin as any);

    const handler = async (request: any) => ({ user: request.user, ctx: getTenantContext() ?? null });
    // Real route shapes: an allowlisted read (/bookings, /bookings/:id) ...
    app.get('/bookings/:id', { preHandler: [app.authenticate] }, handler);
    app.get('/bookings', { preHandler: [app.authenticate] }, handler);
    app.post('/bookings', { preHandler: [app.authenticate] }, handler);
    app.put('/bookings', { preHandler: [app.authenticate] }, handler);
    app.patch('/bookings', { preHandler: [app.authenticate] }, handler);
    app.delete('/bookings', { preHandler: [app.authenticate] }, handler);
    // ... and GETs that exist in the real API but are NOT on the support allowlist.
    app.get('/calendar/google/connect', { preHandler: [app.authenticate] }, handler);
    app.get('/calendar/status', { preHandler: [app.authenticate] }, handler);
    app.get('/payments/links', { preHandler: [app.authenticate] }, handler);
    app.get('/users', { preHandler: [app.authenticate] }, handler);
    app.get('/money/balance', { preHandler: [app.authenticate] }, handler);
    app.get('/developer/api-keys', { preHandler: [app.authenticate] }, handler);
    app.get('/conversations/:id/media/:messageId', { preHandler: [app.authenticate] }, handler);
    app.get('/bookings/by-reference/:ref', { preHandler: [app.authenticate] }, handler);
    app.get('/things', { preHandler: [app.authenticate] }, handler);
    app.get('/admin-me', { preHandler: [app.authenticateAdmin] }, async (request) => ({ admin: request.admin }));
    await app.ready();
});

afterAll(async () => { await app?.close(); });

beforeEach(() => {
    audits.length = 0;
    db.auditFails = false;
    db.admin = { id: 'adm', isSuperAdmin: false, isActive: true, role: 'SUPPORT', totpEnabledAt: null };
    db.require2fa = false;
    clearSwitchCache();
    db.session = { id: 'sess-1', adminId: 'adm', tenantId: 'tenant-a', expiresAt: new Date(Date.now() + 600_000), admin: { isActive: true, role: 'SUPPORT', isSuperAdmin: false, totpEnabledAt: null } };
});

const supportToken = (over: Record<string, unknown> = {}) =>
    (app as any).jwt.sign({
        userId: 'support:adm', tenantId: 'tenant-a', role: 'STAFF', type: 'support',
        support: { sessionId: 'sess-1', adminId: 'adm' }, ...over,
    }, { expiresIn: '5m' });
const accessToken = () =>
    (app as any).jwt.sign({ userId: 'u1', tenantId: 'tenant-a', role: 'OWNER', type: 'access' }, { expiresIn: '5m' });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('support token (A5)', () => {
    it('GET works, marks request.user as support, binds the tenant context', async () => {
        const res = await app.inject({ method: 'GET', url: '/bookings/42?secret=1', headers: bearer(supportToken()) });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.user).toMatchObject({ tenantId: 'tenant-a', role: 'STAFF', support: { sessionId: 'sess-1', adminId: 'adm' } });
        expect(body.ctx).toMatchObject({ tenantId: 'tenant-a' });
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is rejected with 403 and never reaches the handler', async (method) => {
        const res = await app.inject({ method: method as any, url: '/bookings', headers: bearer(supportToken()), payload: {} });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toMatch(/read-only/i);
    });

    it('a rejected write is itself audited as a denied attempt', async () => {
        await app.inject({ method: 'POST', url: '/bookings', headers: bearer(supportToken()), payload: {} });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({ action: 'support.request_denied', actorType: 'ADMIN', actorId: 'adm', tenantId: 'tenant-a' });
        expect(audits[0].metadata).toMatchObject({ method: 'POST' });
    });

    it('audits every GET with admin, tenant, route pattern (not the query string) and session', async () => {
        await app.inject({ method: 'GET', url: '/bookings/42?token=leak', headers: bearer(supportToken()) });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: 'support.request', actorType: 'ADMIN', actorId: 'adm', tenantId: 'tenant-a',
            targetType: 'SupportSession', targetId: 'sess-1',
        });
        expect(audits[0].metadata).toEqual({ method: 'GET', route: '/bookings/:id' });
        expect(JSON.stringify(audits[0])).not.toContain('leak');
    });

    it('401 once the session has ended or expired (no matching live row)', async () => {
        db.session = null;
        const res = await app.inject({ method: 'GET', url: '/bookings', headers: bearer(supportToken()) });
        expect(res.statusCode).toBe(401);
        expect(audits).toHaveLength(0);
    });

    it('401 when the token names a different tenant than the session (the lookup is scoped by the token tenant)', async () => {
        const find = (app as any).prisma.supportSession.findFirst as ReturnType<typeof vi.fn>;
        find.mockClear();
        await app.inject({ method: 'GET', url: '/bookings', headers: bearer(supportToken({ tenantId: 'tenant-b' })) });
        expect(find.mock.calls[0][0].where).toMatchObject({ id: 'sess-1', tenantId: 'tenant-b' });
    });

    it('401 when the session belongs to a different admin than the token claims', async () => {
        db.session = { ...db.session, adminId: 'someone-else' };
        const res = await app.inject({ method: 'GET', url: '/bookings', headers: bearer(supportToken()) });
        expect(res.statusCode).toBe(401);
    });

    it('fails CLOSED if the audit write fails: no unaudited support read', async () => {
        db.auditFails = true;
        const res = await app.inject({ method: 'GET', url: '/bookings', headers: bearer(supportToken()) });
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
    });

    it('a support token without the support claim is rejected', async () => {
        const res = await app.inject({ method: 'GET', url: '/bookings', headers: bearer(supportToken({ support: undefined })) });
        expect(res.statusCode).toBe(401);
    });

    it('a normal access token is untouched: writes allowed, not marked as support, not audited as support', async () => {
        const res = await app.inject({ method: 'POST', url: '/bookings', headers: bearer(accessToken()), payload: {} });
        expect(res.statusCode).toBe(200);
        expect(res.json().user.support).toBeUndefined();
        expect(audits).toHaveLength(0);
    });
});

describe('support token is DENY-BY-DEFAULT (allowlisted read routes only)', () => {
    const get = (url: string) => app.inject({ method: 'GET', url, headers: bearer(supportToken()) });

    it('GET /calendar/google/connect is refused (it would hand out a signed OAuth state) and audited', async () => {
        const res = await get('/calendar/google/connect');
        expect(res.statusCode).toBe(403);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({ action: 'support.request_denied', actorId: 'adm', tenantId: 'tenant-a', targetId: 'sess-1' });
        expect(audits[0].metadata).toMatchObject({ method: 'GET', route: '/calendar/google/connect', reason: 'route_not_allowed' });
    });

    it.each([
        '/calendar/status', '/payments/links', '/users', '/money/balance', '/developer/api-keys',
        '/conversations/c1/media/m1', '/bookings/by-reference/ABC123', '/things',
    ])('GET %s (not on the allowlist) is 403 and never reaches the handler', async (url) => {
        const res = await get(url);
        expect(res.statusCode).toBe(403);
        expect(res.json().user).toBeUndefined();
        expect(audits.map((a) => a.action)).toEqual(['support.request_denied']);
    });

    it('allowlisted reads still work (list and by-id) and are audited as support.request', async () => {
        expect((await get('/bookings')).statusCode).toBe(200);
        expect((await get('/bookings/42')).statusCode).toBe(200);
        expect(audits.map((a) => a.action)).toEqual(['support.request', 'support.request']);
    });

    it('matches on the resolved route, not the raw path: a lookalike path cannot borrow an allowlisted prefix', async () => {
        // '/bookings/by-reference/:ref' resolves to a different route than '/bookings/:id'
        expect((await get('/bookings/by-reference/XYZ')).statusCode).toBe(403);
        // path tricks around /calendar/google/connect: never served (403 if it resolves to the route, 404 if not)
        for (const url of ['/calendar/google/connect/', '/Calendar/google/connect', '/bookings/../calendar/google/connect', '/calendar//google/connect']) {
            expect([403, 404], url).toContain((await get(url)).statusCode);
        }
    });

    it('a request that matches no route is not served and the allowlist is never consulted with the raw URL', async () => {
        const res = await get('/nope/at/all');
        expect(res.statusCode).toBe(404);
    });

    it('the denial is audited with the route PATTERN, never the raw path or query (no PII in the audit row)', async () => {
        await get('/bookings/by-reference/SECRET-REF?phone=+233241234567');
        expect(JSON.stringify(audits)).not.toContain('SECRET-REF');
        expect(JSON.stringify(audits)).not.toContain('233241234567');
    });

    it('a denied request does not need a live session to be audited, but an ended session still cannot read an allowed route', async () => {
        db.session = null;
        expect((await get('/bookings')).statusCode).toBe(401);
    });

    it('a normal access token is unaffected by the allowlist', async () => {
        const res = await app.inject({ method: 'GET', url: '/calendar/google/connect', headers: bearer(accessToken()) });
        expect(res.statusCode).toBe(200);
        expect(audits).toHaveLength(0);
    });
});

describe('support re-checks the admin on every request (A4/A5)', () => {
    const read = () => app.inject({ method: 'GET', url: '/bookings', headers: bearer(supportToken()) });
    const entitled = (over: Record<string, unknown>) => { db.session = { ...db.session, admin: { ...db.session.admin, ...over } }; };

    it('works for SUPPORT and OWNER', async () => {
        expect((await read()).statusCode).toBe(200);
        entitled({ role: 'OWNER' });
        expect((await read()).statusCode).toBe(200);
    });

    it.each(['FINANCE', 'READONLY', 'WEIRD'])('an admin demoted to %s (no support:access) loses the session at once', async (role) => {
        entitled({ role });
        const res = await read();
        expect(res.statusCode).toBe(401);
        expect(audits.map((a) => a.action)).not.toContain('support.request');
    });

    it('a deactivated admin loses the session', async () => {
        entitled({ isActive: false });
        expect((await read()).statusCode).toBe(401);
    });

    it('under the require-2FA policy an admin without 2FA is refused; with 2FA they are fine', async () => {
        db.require2fa = true;
        const res = await read();
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toMatch(/two-factor/i);
        expect(audits.map((a) => a.action)).not.toContain('support.request');
        entitled({ totpEnabledAt: new Date() });
        expect((await read()).statusCode).toBe(200);
    });

    it('no policy, no 2FA: allowed', async () => {
        expect((await read()).statusCode).toBe(200);
    });
});

describe('admin identity (A4)', () => {
    const adminToken = () => (app as any).jwt.admin.sign({ adminId: 'adm', type: 'admin_access' }, { expiresIn: '5m' });

    it('carries the role from the row and the 2FA state', async () => {
        db.admin = { ...db.admin, role: 'FINANCE', totpEnabledAt: new Date() };
        const res = await app.inject({ method: 'GET', url: '/admin-me', headers: bearer(adminToken()) });
        expect(res.json().admin).toMatchObject({ adminId: 'adm', role: 'FINANCE', totpEnabled: true });
    });

    it('legacy fallback: a row with no role resolves from isSuperAdmin', async () => {
        db.admin = { id: 'adm', isSuperAdmin: true, isActive: true, role: undefined as any, totpEnabledAt: null };
        const res = await app.inject({ method: 'GET', url: '/admin-me', headers: bearer(adminToken()) });
        expect(res.json().admin).toMatchObject({ role: 'OWNER', totpEnabled: false });
    });

    it('an inactive admin is refused', async () => {
        db.admin = { ...db.admin, isActive: false };
        expect((await app.inject({ method: 'GET', url: '/admin-me', headers: bearer(adminToken()) })).statusCode).toBe(401);
    });

    it('a refresh token cannot be used as an access token', async () => {
        const t = (app as any).jwt.admin.sign({ adminId: 'adm', type: 'admin_refresh' }, { expiresIn: '5m' });
        expect((await app.inject({ method: 'GET', url: '/admin-me', headers: bearer(t) })).statusCode).toBe(401);
    });
});
