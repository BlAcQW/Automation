import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

vi.mock('../../plugins/prisma.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('prisma', (globalThis as any).__prismaStub);
    }, { name: 'prisma' }),
}));

vi.mock('../../plugins/auth.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('authenticate', async () => undefined);
        app.decorate('authenticateAdmin', async (request: any) => {
            request.admin = { adminId: 'admin-1', isSuperAdmin: true, role: 'OWNER', totpEnabled: true };
        });
    }, { name: 'auth' }),
}));

vi.mock('../../plugins/redis.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('redis', null);
        app.decorate('queues', { notifications: null, reminders: null });
    }, { name: 'redis' }),
}));

const state = { creds: true, sendOk: true, sent: [] as any[] };
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => (state.creds ? { user: 'noreply@bookly.test', appPassword: 'x', source: 'platform' } : null),
    sendEmail: vi.fn(async (args: any) => {
        state.sent.push(args);
        return state.sendOk ? { ok: true } : { ok: false, error: 'gmail_send: down' };
    }),
}));

const stub: any = {
    existingEmail: false,
    audits: [] as any[],
    user: { findFirst: vi.fn(async () => (stub.existingEmail ? { id: 'u0' } : null)) },
    auditLog: { create: vi.fn(async (a: any) => { stub.audits.push(a.data); return {}; }) },
    tenant: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    tenantUsage: { findMany: vi.fn(async () => []) },
    platformSetting: { findUnique: vi.fn(async () => null) },
    platformAlert: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => ({ id: 'a1', tenantId: null, kind: 'k', severity: 'warning', resolvedAt: new Date(), resolvedBy: 'admin-1' })),
    },
    $transaction: vi.fn(async (fn: any) => fn({
        tenant: { create: vi.fn(async (a: any) => ({ id: 't1', ...a.data })) },
        user: { create: vi.fn(async (a: any) => ({ id: 'u1', ...a.data })), findFirst: vi.fn(async () => null) },
        $executeRaw: vi.fn(async () => 0),
        workingHours: { createMany: vi.fn(async () => ({ count: 5 })) },
        wallet: { create: vi.fn(async (a: any) => ({ id: 'w1', currency: a.data.currency })) },
    })),
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => [{ '?column?': 1 }],
    $queryRawUnsafe: async () => [{ '?column?': 1 }],
};
(globalThis as any).__prismaStub = stub;

let app: FastifyInstance;
beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation';
    process.env.FRONTEND_URL = 'https://app.bookly.test';
    const { buildApp } = await import('../../index.js');
    app = await buildApp();
    await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
    state.creds = true; state.sendOk = true; state.sent.length = 0;
    stub.existingEmail = false; stub.audits.length = 0;
    stub.platformAlert.updateMany.mockClear();
});

const body = {
    name: 'Swift Rides', timezone: 'Africa/Accra', vertical: 'RIDES', planId: 'pro',
    owner: { name: 'Kofi Boateng', email: 'kofi@example.com' },
};
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/admin/tenants', payload: payload as any });

describe('POST /admin/tenants', () => {
    it('creates the org, emails the invite, audits without leaking the link', async () => {
        const res = await post(body);
        expect(res.statusCode).toBe(201);
        const j = res.json();
        expect(j.tenant).toMatchObject({ id: 't1', vertical: 'RIDES', planId: 'pro' });
        expect(j.owner).toMatchObject({ email: 'kofi@example.com' });
        expect(j.invite).toEqual({ sent: true });
        expect(state.sent).toHaveLength(1);
        expect(state.sent[0].to).toBe('kofi@example.com');
        expect(stub.audits).toHaveLength(1);
        expect(stub.audits[0]).toMatchObject({ action: 'tenant.created', actorType: 'ADMIN', actorId: 'admin-1', tenantId: 't1' });
        expect(JSON.stringify(stub.audits[0])).not.toContain('reset-password');
    });

    it('returns the invite link in the response when SMTP is not configured', async () => {
        state.creds = false;
        const res = await post(body);
        expect(res.statusCode).toBe(201);
        expect(res.json().invite).toMatchObject({ sent: false, reason: 'email_not_configured' });
        expect(res.json().invite.link).toContain('https://app.bookly.test/reset-password?token=');
        expect(state.sent).toHaveLength(0);
    });

    it('returns the link when the send fails', async () => {
        state.sendOk = false;
        const res = await post(body);
        expect(res.statusCode).toBe(201);
        expect(res.json().invite).toMatchObject({ sent: false, reason: 'send_failed' });
    });

    it('409 on duplicate owner email, nothing audited', async () => {
        stub.existingEmail = true;
        const res = await post(body);
        expect(res.statusCode).toBe(409);
        expect(stub.audits).toHaveLength(0);
    });

    it('400 on invalid body', async () => {
        expect((await post({ ...body, timezone: 'Nope/Zone' })).statusCode).toBe(400);
        expect((await post({ ...body, extra: 1 })).statusCode).toBe(400);
        expect((await post({})).statusCode).toBe(400);
    });
});

describe('alerts endpoints', () => {
    it('lists open alerts newest lastSeenAt first', async () => {
        const res = await app.inject({ method: 'GET', url: '/admin/alerts?severity=critical' });
        expect(res.statusCode).toBe(200);
        const args = stub.platformAlert.findMany.mock.calls.at(-1)[0];
        expect(args.where).toEqual({ resolvedAt: null, severity: 'critical' });
        expect(args.orderBy).toEqual({ lastSeenAt: 'desc' });
        expect(res.json().pagination.total).toBe(0);
    });
    it('rejects a bad status', async () => {
        expect((await app.inject({ method: 'GET', url: '/admin/alerts?status=zzz' })).statusCode).toBe(400);
    });
    it('resolves, recording the admin id, and audits', async () => {
        const res = await app.inject({ method: 'POST', url: '/admin/alerts/a1/resolve' });
        expect(res.statusCode).toBe(200);
        const upd = stub.platformAlert.updateMany.mock.calls[0][0];
        expect(upd.where).toEqual({ id: 'a1', resolvedAt: null });
        expect(upd.data.resolvedBy).toBe('admin-1');
        expect(stub.audits[0]).toMatchObject({ action: 'alert.resolved', actorType: 'ADMIN', targetId: 'a1' });
    });
    it('404 for an unknown alert', async () => {
        stub.platformAlert.updateMany.mockResolvedValueOnce({ count: 0 });
        stub.platformAlert.findUnique.mockResolvedValueOnce(null);
        expect((await app.inject({ method: 'POST', url: '/admin/alerts/zz/resolve' })).statusCode).toBe(404);
    });
});
