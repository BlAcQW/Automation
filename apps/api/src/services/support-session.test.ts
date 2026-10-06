import { describe, it, expect, vi } from 'vitest';
import {
    startSupportSession,
    endSupportSession,
    findLiveSession,
    supportTokenTtlSeconds,
    supportTokenPayload,
    listSupportSessions,
    SupportSessionError,
    MAX_SUPPORT_MINUTES,
    DEFAULT_SUPPORT_MINUTES,
    SUPPORT_TOKEN_MAX_SECONDS,
} from './support-session.js';

const T0 = new Date('2026-10-06T10:00:00Z');

function stub(opts: { tenant?: any; session?: any } = {}) {
    const created: any[] = [];
    const prisma: any = {
        created,
        tenant: { findUnique: vi.fn(async () => (opts.tenant === undefined ? { id: 't1', isActive: true } : opts.tenant)) },
        supportSession: {
            updateMany: vi.fn(async () => ({ count: 0 })),
            create: vi.fn(async ({ data }: any) => { const row = { id: 's1', createdAt: T0, endedAt: null, ...data }; created.push(row); return row; }),
            findFirst: vi.fn(async () => opts.session ?? null),
            findMany: vi.fn(async () => []),
        },
    };
    return prisma;
}

describe('startSupportSession', () => {
    it('requires a real reason', async () => {
        for (const reason of ['', '   ', 'ab', undefined as any]) {
            await expect(startSupportSession(stub(), { adminId: 'a1', tenantId: 't1', reason }, T0)).rejects.toBeInstanceOf(SupportSessionError);
        }
    });

    it('creates a READ_ONLY session with the default duration', async () => {
        const prisma = stub();
        const s = await startSupportSession(prisma, { adminId: 'a1', tenantId: 't1', reason: 'Customer cannot see bookings' }, T0);
        expect(s.mode).toBe('READ_ONLY');
        expect(s.expiresAt.getTime() - T0.getTime()).toBe(DEFAULT_SUPPORT_MINUTES * 60_000);
        expect(prisma.created[0]).toMatchObject({ adminId: 'a1', tenantId: 't1', reason: 'Customer cannot see bookings', mode: 'READ_ONLY' });
    });

    it('caps the duration at the maximum and rejects nonsense', async () => {
        const prisma = stub();
        const s = await startSupportSession(prisma, { adminId: 'a1', tenantId: 't1', reason: 'long investigation', minutes: 9999 }, T0);
        expect(s.expiresAt.getTime() - T0.getTime()).toBe(MAX_SUPPORT_MINUTES * 60_000);
        for (const minutes of [0, -5, 1.5, NaN]) {
            await expect(startSupportSession(stub(), { adminId: 'a1', tenantId: 't1', reason: 'long investigation', minutes }, T0)).rejects.toBeInstanceOf(SupportSessionError);
        }
    });

    it('the mode is not caller-controlled: there is no way to ask for WRITE', async () => {
        const prisma = stub();
        await startSupportSession(prisma, { adminId: 'a1', tenantId: 't1', reason: 'long investigation', mode: 'WRITE' } as any, T0);
        expect(prisma.created[0].mode).toBe('READ_ONLY');
    });

    it('404-style error for an unknown tenant, and nothing is created', async () => {
        const prisma = stub({ tenant: null });
        await expect(startSupportSession(prisma, { adminId: 'a1', tenantId: 'nope', reason: 'long investigation' }, T0))
            .rejects.toMatchObject({ code: 'tenant_not_found' });
        expect(prisma.supportSession.create).not.toHaveBeenCalled();
    });

    it('ends this admin\'s earlier live session on the same tenant first (at most one live)', async () => {
        const prisma = stub();
        await startSupportSession(prisma, { adminId: 'a1', tenantId: 't1', reason: 'long investigation' }, T0);
        const where = prisma.supportSession.updateMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ adminId: 'a1', tenantId: 't1', endedAt: null });
        expect(where.expiresAt).toEqual({ gt: T0 });
    });

    it('trims and bounds the reason', async () => {
        const prisma = stub();
        await startSupportSession(prisma, { adminId: 'a1', tenantId: 't1', reason: `  ${'x'.repeat(900)}  ` }, T0);
        expect(prisma.created[0].reason).toHaveLength(300);
    });
});

describe('findLiveSession', () => {
    it('queries by id AND tenant, not ended, not expired', async () => {
        const prisma = stub({ session: { id: 's1', adminId: 'a1', tenantId: 't1', expiresAt: new Date(T0.getTime() + 1000), admin: { isActive: true } } });
        const s = await findLiveSession(prisma, 's1', 't1', T0);
        expect(s?.id).toBe('s1');
        const where = prisma.supportSession.findFirst.mock.calls[0][0].where;
        expect(where).toMatchObject({ id: 's1', tenantId: 't1', endedAt: null, expiresAt: { gt: T0 } });
    });
    it('refuses when the admin has since been deactivated', async () => {
        const prisma = stub({ session: { id: 's1', adminId: 'a1', tenantId: 't1', expiresAt: new Date(T0.getTime() + 1000), admin: { isActive: false } } });
        expect(await findLiveSession(prisma, 's1', 't1', T0)).toBeNull();
    });
    it('null when there is no live row', async () => {
        expect(await findLiveSession(stub(), 's1', 't1', T0)).toBeNull();
    });
});

describe('endSupportSession', () => {
    it('an admin may end their own session; ownership is part of the where clause', async () => {
        const prisma = stub();
        prisma.supportSession.updateMany.mockResolvedValue({ count: 1 });
        expect(await endSupportSession(prisma, 's1', { adminId: 'a1', role: 'SUPPORT' }, T0)).toBe(true);
        const call = prisma.supportSession.updateMany.mock.calls[0][0];
        expect(call.where).toMatchObject({ id: 's1', adminId: 'a1', endedAt: null });
        expect(call.data).toEqual({ endedAt: T0 });
    });
    it('an OWNER may end anyone\'s session', async () => {
        const prisma = stub();
        prisma.supportSession.updateMany.mockResolvedValue({ count: 1 });
        await endSupportSession(prisma, 's1', { adminId: 'owner', role: 'OWNER' }, T0);
        expect(prisma.supportSession.updateMany.mock.calls[0][0].where.adminId).toBeUndefined();
    });
    it('false when nothing matched (already ended, or not yours)', async () => {
        expect(await endSupportSession(stub(), 's1', { adminId: 'a1', role: 'SUPPORT' }, T0)).toBe(false);
    });
});

describe('support token', () => {
    it('is short-lived: never longer than the cap, never longer than the session', () => {
        const long = { expiresAt: new Date(T0.getTime() + 60 * 60_000) };
        expect(supportTokenTtlSeconds(long, T0)).toBe(SUPPORT_TOKEN_MAX_SECONDS);
        const short = { expiresAt: new Date(T0.getTime() + 90_000) };
        expect(supportTokenTtlSeconds(short, T0)).toBe(90);
    });
    it('is zero for an expired session', () => {
        expect(supportTokenTtlSeconds({ expiresAt: new Date(T0.getTime() - 1) }, T0)).toBe(0);
    });
    it('carries type "support" (so no access-token consumer accepts it), a STAFF role and a non-user id', () => {
        const p = supportTokenPayload({ id: 's1', adminId: 'a1', tenantId: 't1' });
        expect(p).toEqual({
            userId: 'support:a1', tenantId: 't1', role: 'STAFF', type: 'support',
            support: { sessionId: 's1', adminId: 'a1' },
        });
    });
});

describe('listSupportSessions', () => {
    it('bounds the query', async () => {
        const prisma = stub();
        await listSupportSessions(prisma, { tenantId: 't1', limit: 5000 });
        const args = prisma.supportSession.findMany.mock.calls[0][0];
        expect(args.take).toBeLessThanOrEqual(100);
        expect(args.where).toMatchObject({ tenantId: 't1' });
    });
});

describe('findOwnLiveSession', () => {
    it('is keyed by session AND admin, live only', async () => {
        const { findOwnLiveSession } = await import('./support-session.js');
        const prisma = stub({ session: { id: 's1', adminId: 'a1', tenantId: 't1', expiresAt: new Date(T0.getTime() + 1000), admin: { isActive: true } } });
        expect((await findOwnLiveSession(prisma, 's1', 'a1', T0))?.id).toBe('s1');
        expect(prisma.supportSession.findFirst.mock.calls[0][0].where).toMatchObject({ id: 's1', adminId: 'a1', endedAt: null, expiresAt: { gt: T0 } });
        expect(await findOwnLiveSession(stub(), 's1', 'a1', T0)).toBeNull();
    });
});

describe('support read allowlist', () => {
    it('is exact-match on the resolved route pattern, GET-only by construction (patterns carry no method)', async () => {
        const { isSupportReadRoute } = await import('./support-session.js');
        expect(isSupportReadRoute('/bookings')).toBe(true);
        expect(isSupportReadRoute('/bookings/:id')).toBe(true);
        expect(isSupportReadRoute('/bookings/')).toBe(true); // trailing-slash twin of the same route
        expect(isSupportReadRoute('/bookings/by-reference/:ref')).toBe(false);
        expect(isSupportReadRoute('/bookings/42')).toBe(false); // raw paths never match: only patterns do
    });

    it('unknown, empty and undefined routes are refused', async () => {
        const { isSupportReadRoute } = await import('./support-session.js');
        for (const r of [undefined, null, '', '/', '*', '/*', '/unknown']) expect(isSupportReadRoute(r as any)).toBe(false);
    });

    it('no entry is a prefix wildcard, and nothing sensitive is on the list', async () => {
        const { SUPPORT_READ_ROUTES } = await import('./support-session.js');
        const forbidden = /calendar|payment|whatsapp|channel|users|money|developer|webhook|billing|connect|callback|token|secret|key|media|reveal|invite|by-reference\/:ref$/;
        for (const r of SUPPORT_READ_ROUTES) {
            expect(r.includes('*'), r).toBe(false);
            // orders/by-reference is deliberate: that handler masks (checked below)
            if (r === '/orders/by-reference/:ref') continue;
            expect(forbidden.test(r), r).toBe(false);
        }
        expect(SUPPORT_READ_ROUTES).not.toContain('/bookings/by-reference/:ref');
        expect(SUPPORT_READ_ROUTES).not.toContain('/conversations/:id/media/:messageId');
    });

    it('every allowlisted route really exists as a GET in the route files (no dead or misspelt entry)', async () => {
        const { SUPPORT_READ_ROUTES } = await import('./support-session.js');
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const routesDir = `${resolve(__dirname, '../routes')}/`;
        for (const route of SUPPORT_READ_ROUTES) {
            const [, prefix, ...rest] = route.split('/');
            const sub = rest.length ? `/${rest.join('/')}` : '/';
            const src = readFileSync(`${routesDir}${prefix}/index.ts`, 'utf8');
            expect(src.includes(`fastify.get('${sub}'`), `${route} -> ${prefix}/index.ts get('${sub}')`).toBe(true);
        }
    });

    it('every allowlisted route that returns customer contacts calls resolveMaskPolicy with the support flag', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const routesDir = `${resolve(__dirname, '../routes')}/`;
        for (const dir of ['bookings', 'conversations', 'orders', 'customers', 'privacy']) {
            const src = readFileSync(`${routesDir}${dir}/index.ts`, 'utf8');
            const calls = src.match(/resolveMaskPolicy\([^;]*\);/gs) ?? [];
            expect(calls.length, dir).toBeGreaterThan(0);
            for (const c of calls) expect(c, `${dir}: ${c}`).toMatch(/request\.user\.support/);
        }
    });
});

describe('checkSupportEntitlement', () => {
    it('requires an active admin who holds support:access', async () => {
        const { checkSupportEntitlement } = await import('./support-session.js');
        expect(checkSupportEntitlement({ isActive: true, role: 'SUPPORT' }, false)).toEqual({ ok: true });
        expect(checkSupportEntitlement({ isActive: true, role: 'OWNER' }, false)).toEqual({ ok: true });
        expect(checkSupportEntitlement({ isActive: false, role: 'OWNER' }, false)).toEqual({ ok: false, reason: 'inactive' });
        expect(checkSupportEntitlement(null, false)).toEqual({ ok: false, reason: 'inactive' });
        for (const role of ['FINANCE', 'READONLY', 'GARBAGE']) {
            expect(checkSupportEntitlement({ isActive: true, role }, false)).toEqual({ ok: false, reason: 'no_support_permission' });
        }
    });
    it('falls back to the legacy flag only when the role is missing', async () => {
        const { checkSupportEntitlement } = await import('./support-session.js');
        expect(checkSupportEntitlement({ isActive: true, role: null, isSuperAdmin: true }, false).ok).toBe(true);
        expect(checkSupportEntitlement({ isActive: true, role: 'READONLY', isSuperAdmin: true }, false).ok).toBe(false);
    });
    it('under the 2FA policy an admin without 2FA is refused', async () => {
        const { checkSupportEntitlement } = await import('./support-session.js');
        expect(checkSupportEntitlement({ isActive: true, role: 'SUPPORT', totpEnabledAt: null }, true)).toEqual({ ok: false, reason: 'two_factor_required' });
        expect(checkSupportEntitlement({ isActive: true, role: 'SUPPORT', totpEnabledAt: new Date() }, true).ok).toBe(true);
    });
});
