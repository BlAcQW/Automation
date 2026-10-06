/**
 * Proves the WIRING, not the individual handlers: every admin route is behind
 * the role guard, and each route's permission matches this independent table.
 * A route someone adds (or un-guards) later fails here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authorizeAdmin, ADMIN_ROLES, type AdminPermission } from '../../services/admin-permissions.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => null,
    sendEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../services/events/emit.js', () => ({
    emitConversationHandoff: vi.fn(async () => undefined),
    emitConversationResumed: vi.fn(async () => undefined),
}));

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

const PUBLIC = new Set(['POST /admin/auth/login', 'POST /admin/auth/refresh', 'POST /admin/auth/logout']);

type Row = [method: string, url: string, permission: AdminPermission];
const TABLE: Row[] = [
    ['GET', '/admin/auth/me', 'self'],
    ['PATCH', '/admin/auth/password', 'self'],
    ['POST', '/admin/auth/2fa/enrol', 'self'],
    ['POST', '/admin/auth/2fa/verify', 'self'],
    ['POST', '/admin/auth/2fa/disable', 'self'],
    ['POST', '/admin/auth/2fa/recovery-codes', 'self'],
    ['PUT', '/admin/security/two-factor', 'security:policy'],
    ['GET', '/admin/admins', 'admins:manage'],
    ['POST', '/admin/admins', 'admins:manage'],
    ['PATCH', '/admin/admins/x', 'admins:manage'],
    ['POST', '/admin/admins/x/reset-2fa', 'admins:manage'],
    ['GET', '/admin/stats', 'stats:read'],
    ['GET', '/admin/alerts', 'alerts:read'],
    ['POST', '/admin/alerts/a1/resolve', 'alerts:write'],
    ['GET', '/admin/tenants', 'tenants:read'],
    ['POST', '/admin/tenants', 'tenants:write'],
    ['GET', '/admin/tenants/t1', 'tenants:read'],
    ['PATCH', '/admin/tenants/t1', 'tenants:write'],
    ['DELETE', '/admin/tenants/t1', 'tenants:delete'],
    ['GET', '/admin/tenants/t1/overview', 'tenants:read'],
    ['GET', '/admin/users', 'users:read'],
    ['GET', '/admin/users/u1', 'users:read'],
    ['PATCH', '/admin/users/u1', 'users:write'],
    ['GET', '/admin/bookings', 'bookings:read'],
    ['GET', '/admin/promo-codes', 'promos:read'],
    ['GET', '/admin/promo-codes/p1/redemptions', 'promos:read'],
    ['POST', '/admin/promo-codes', 'promos:write'],
    ['PATCH', '/admin/promo-codes/p1', 'promos:write'],
    ['GET', '/admin/attention', 'attention:read'],
    ['GET', '/admin/money/overview', 'money:read'],
    ['GET', '/admin/money/payouts', 'money:read'],
    ['GET', '/admin/money/refunds', 'money:read'],
    ['GET', '/admin/audit', 'audit:read'],
    ['GET', '/admin/messaging/health', 'messaging:read'],
    ['POST', '/admin/tenants/t1/support-sessions', 'support:access'],
    ['POST', '/admin/support-sessions/s1/token', 'support:access'],
    ['POST', '/admin/support-sessions/s1/end', 'support:access'],
    ['GET', '/admin/support-sessions', 'audit:read'],
    ['PUT', '/admin/tenants/t1/switches/outbound', 'outbound:switch'],
    ['PUT', '/admin/tenants/t1/switches/payouts', 'payouts:switch'],
    ['GET', '/admin/platform/switches', 'attention:read'],
    ['PUT', '/admin/platform/switches/payouts', 'payouts:platform_switch'],
    ['PUT', '/admin/platform/switches/outbound', 'outbound:platform_switch'],
    ['POST', '/admin/conversations/c1/handoff', 'conversations:handoff'],
    ['GET', '/admin/flows?tenantId=t1', 'flows:read'],
    ['GET', '/admin/flows/main/versions/1?tenantId=t1', 'flows:read'],
    ['POST', '/admin/flows/validate', 'flows:read'],
    ['POST', '/admin/flows/main/versions', 'flows:write'],
    ['POST', '/admin/flows/main/activate', 'flows:write'],
    // /admin/billing/** lives in routes/admin-billing but is part of the same admin surface.
    ['GET', '/admin/billing/event-types', 'billing:read'],
    ['GET', '/admin/billing/tenants', 'billing:read'],
    ['GET', '/admin/billing/tenants/t1/terms', 'billing:read'],
    ['PUT', '/admin/billing/tenants/t1/terms', 'billing:write'],
    ['GET', '/admin/billing/tenants/t1/statement', 'billing:read'],
    ['GET', '/admin/billing/tenants/t1/statement.csv', 'billing:read'],
];

async function build() {
    prisma = makePrisma();
    const routes: Array<{ method: string; url: string; pre: unknown }> = [];
    const adminRoutes = (await import('./index.js')).default;
    app = await buildAdminTestApp(async (scope) => {
        scope.addHook('onRoute', (r) => {
            for (const m of ([] as string[]).concat(r.method)) {
                if (m !== 'HEAD' && m !== 'OPTIONS') routes.push({ method: m, url: r.url, pre: r.preHandler });
            }
        });
        await scope.register(adminRoutes as never);
        // Mounted at /admin/billing in src/index.ts.
        const adminBilling = (await import('../admin-billing/index.js')).default;
        await scope.register(adminBilling as never, { prefix: '/billing' });
    }, { prisma });
    return routes;
}

describe('every admin route is behind the role guard', () => {
    it('no route is registered without a guard chain (except sign-in/refresh/logout)', async () => {
        const routes = await build();
        expect(routes.length).toBeGreaterThan(40);
        const unguarded = routes.filter((r) => !PUBLIC.has(`${r.method} ${r.url}`) && !(Array.isArray(r.pre) && r.pre.length >= 2));
        expect(unguarded.map((r) => `${r.method} ${r.url}`)).toEqual([]);
    });

    it('every registered route is covered by the permission table below (a new route must be classified here)', async () => {
        const routes = await build();
        const tableEntries = TABLE.map(([m, u]) => `${m} ${u.split('?')[0]}`);
        const uncovered = routes
            .filter((r) => !PUBLIC.has(`${r.method} ${r.url}`))
            .filter((r) => {
                const pattern = new RegExp(`^${r.method} ${r.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+')}$`);
                return !tableEntries.some((e) => pattern.test(e));
            })
            .map((r) => `${r.method} ${r.url}`);
        expect(uncovered).toEqual([]);
    });
});

describe('billing routes are part of the guarded, classified surface', () => {
    it('includes /admin/billing routes in the registered set, all guarded', async () => {
        const routes = await build();
        const billing = routes.filter((r) => r.url.startsWith('/admin/billing'));
        expect(billing.length).toBeGreaterThanOrEqual(6);
        expect(billing.filter((r) => !(Array.isArray(r.pre) && r.pre.length >= 2))).toEqual([]);
    });
    it('every /admin/billing route is classified in the table with billing:read or billing:write', async () => {
        const routes = await build();
        const billingTable = TABLE.filter(([, u]) => u.startsWith('/admin/billing'));
        expect(billingTable.every(([, , p]) => p === 'billing:read' || p === 'billing:write')).toBe(true);
        expect(billingTable.length).toBe(routes.filter((r) => r.url.startsWith('/admin/billing')).length);
    });
    it('the 2FA-required policy blocks billing routes for an admin without 2FA', async () => {
        await build();
        prisma.platformSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
        const { headers } = signedInAs(app, prisma, 'FINANCE');
        const res = await app.inject({ method: 'GET', url: '/admin/billing/tenants', headers });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toMatch(/two-factor/i);
    });
});

describe('role matrix', () => {
    it.each(ADMIN_ROLES)('%s: every route answers 403 exactly when the role map says so', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        const mismatches: string[] = [];
        for (const [method, url, permission] of TABLE) {
            const res = await app.inject({ method: method as any, url, headers, payload: ['GET', 'DELETE'].includes(method) ? undefined : {} });
            const allowed = authorizeAdmin(role, permission, method).ok;
            const denied = res.statusCode === 403;
            // An allowed call may fail for other reasons (400/404/422/500 on empty stubs), but never 401/403-by-role.
            if (allowed === denied) mismatches.push(`${method} ${url} as ${role}: expected ${allowed ? 'allowed' : '403'}, got ${res.statusCode}`);
            if (res.statusCode === 401) mismatches.push(`${method} ${url} unexpectedly 401`);
        }
        expect(mismatches).toEqual([]);
    });

    it('all routes are 401 without a token', async () => {
        await build();
        const failures: string[] = [];
        for (const [method, url] of TABLE) {
            const res = await app.inject({ method: method as any, url, payload: ['GET', 'DELETE'].includes(method) ? undefined : {} });
            if (res.statusCode !== 401) failures.push(`${method} ${url} -> ${res.statusCode}`);
        }
        expect(failures).toEqual([]);
    });

    it('READONLY cannot perform any non-GET route except its own `self` ones', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        for (const [method, url, permission] of TABLE.filter(([m, , p]) => m !== 'GET' && p !== 'self' && p !== 'flows:read')) {
            const res = await app.inject({ method: method as any, url, headers, payload: method === 'DELETE' ? undefined : {} });
            expect(res.statusCode, `${method} ${url}`).toBe(403);
            void permission;
        }
    });
});

describe('platform 2FA requirement', () => {
    it('an admin without 2FA is refused everything but `self` routes while the policy is on', async () => {
        await build();
        prisma.platformSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
        const { headers } = signedInAs(app, prisma, 'OWNER'); // totpEnabledAt null
        const blocked = await app.inject({ method: 'GET', url: '/admin/tenants', headers });
        expect(blocked.statusCode).toBe(403);
        expect(blocked.json().message).toMatch(/two-factor/i);
        const me = await app.inject({ method: 'GET', url: '/admin/auth/me', headers });
        expect(me.statusCode).toBe(200);
        expect(me.json().twoFactorRequired).toBe(true);
    });

    it('an admin WITH 2FA is not affected', async () => {
        await build();
        prisma.platformSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
        const { headers } = signedInAs(app, prisma, 'OWNER', { totpEnabledAt: new Date(), totpSecretEnc: 'x' });
        expect((await app.inject({ method: 'GET', url: '/admin/alerts', headers })).statusCode).toBe(200);
    });
});
