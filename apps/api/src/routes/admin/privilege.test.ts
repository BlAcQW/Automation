/**
 * Privilege boundaries inside /admin that role checks alone do not express:
 * plan/quota changes belong to billing:write, handing a tenant user OWNER
 * (who can withdraw money) belongs to an OWNER admin, and the destructive
 * tenant/user changes leave an audit row. Real routes + real guard + stub db.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';
import { clearSwitchCache } from '../../services/platform-switches.js';

vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => null,
    sendEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../services/events/emit.js', () => ({
    emitConversationHandoff: vi.fn(async () => undefined),
    emitConversationResumed: vi.fn(async () => undefined),
}));
const created = vi.fn();
vi.mock('../../services/tenant-onboarding.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../services/tenant-onboarding.js')>();
    return {
        ...real,
        createTenantWithOwner: vi.fn(async (_deps: unknown, input: any) => {
            created(input);
            return {
                tenant: { id: 't9', name: input.name, timezone: input.timezone, vertical: input.vertical, planId: input.planId, monthlyMessageQuotaOverride: input.monthlyMessageQuotaOverride ?? null },
                owner: { id: 'u9', name: input.owner.name, email: input.owner.email },
                invite: { sent: true },
            };
        }),
    };
});

let app: FastifyInstance;
let prisma: PrismaStub;
beforeEach(() => { clearSwitchCache(); created.mockClear(); });
afterEach(async () => { await app?.close(); });

const TENANT = { id: 't1', vertical: 'APPOINTMENTS', planId: 'free', monthlyMessageQuotaOverride: null, isActive: true };

async function build(redis?: unknown) {
    prisma = makePrisma();
    const adminRoutes = (await import('./index.js')).default;
    app = await buildAdminTestApp(async (scope) => { await scope.register(adminRoutes as never); }, { prisma, redis });
    prisma.tenant.findUnique.mockResolvedValue(TENANT);
    prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ ...TENANT, name: 'Acme', timezone: 'UTC' });
}
const patchTenant = (role: string, payload: unknown) => {
    const { headers } = signedInAs(app, prisma, role);
    return app.inject({ method: 'PATCH', url: '/admin/tenants/t1', headers, payload: payload as any });
};

describe('PATCH /admin/tenants/:id: plan and quota are billing:write', () => {
    it.each([{ planId: 'pro' }, { monthlyMessageQuotaOverride: 5000 }, { planId: 'pro', monthlyMessageQuotaOverride: null }])('SUPPORT cannot change %j (403, nothing written)', async (payload) => {
        await build();
        const res = await patchTenant('SUPPORT', payload);
        expect(res.statusCode).toBe(403);
        expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    });

    it('SUPPORT can still change ordinary fields', async () => {
        await build();
        expect((await patchTenant('SUPPORT', { name: 'Acme' })).statusCode).toBe(200);
        expect(prisma.tenant.updateMany).toHaveBeenCalledTimes(1);
    });

    it('SUPPORT cannot smuggle a plan change in alongside an ordinary field', async () => {
        await build();
        expect((await patchTenant('SUPPORT', { name: 'Acme', planId: 'pro' })).statusCode).toBe(403);
        expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    });

    it('FINANCE (billing:write) may change plan and quota, but not the ordinary fields it lacks tenants:write for', async () => {
        await build();
        expect((await patchTenant('FINANCE', { planId: 'pro', monthlyMessageQuotaOverride: 100 })).statusCode).toBe(200);
        expect(prisma.tenant.updateMany).toHaveBeenCalledTimes(1);
        prisma.tenant.updateMany.mockClear();
        expect((await patchTenant('FINANCE', { name: 'Acme' })).statusCode).toBe(403);
        expect((await patchTenant('FINANCE', { name: 'Acme', planId: 'pro' })).statusCode).toBe(403);
        expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    });

    it('OWNER may change everything; READONLY nothing; the audit row records before and after', async () => {
        await build();
        expect((await patchTenant('OWNER', { name: 'Acme', planId: 'pro' })).statusCode).toBe(200);
        expect(prisma.audits.at(-1)).toMatchObject({
            action: 'tenant.updated', tenantId: 't1',
            metadata: { name: 'Acme', planId: 'pro', before: { planId: 'free', monthlyMessageQuotaOverride: null } },
        });
        expect((await patchTenant('READONLY', { planId: 'pro' })).statusCode).toBe(403);
    });
});

describe('POST /admin/tenants: a paid plan or quota override at creation is billing:write too', () => {
    const body = (over: Record<string, unknown> = {}) => ({
        name: 'Acme Rides', timezone: 'Africa/Accra', vertical: 'RIDES', planId: 'free',
        owner: { name: 'Kofi Mensah', email: 'kofi@example.com' }, ...over,
    });
    const post = (role: string, payload: unknown) => {
        const { headers } = signedInAs(app, prisma, role);
        return app.inject({ method: 'POST', url: '/admin/tenants', headers, payload: payload as any });
    };

    it('SUPPORT may create a free-plan organisation', async () => {
        await build();
        expect((await post('SUPPORT', body())).statusCode).toBe(201);
    });
    it.each([{ planId: 'pro' }, { monthlyMessageQuotaOverride: 100000 }])('SUPPORT is refused %j and nothing is created', async (over) => {
        await build();
        expect((await post('SUPPORT', body(over))).statusCode).toBe(403);
        expect(created).not.toHaveBeenCalled();
    });
    it('OWNER may create with a paid plan', async () => {
        await build();
        expect((await post('OWNER', body({ planId: 'pro' }))).statusCode).toBe(201);
    });
});

describe('DELETE /admin/tenants/:id', () => {
    it('404 for an unknown id (not a 500), nothing updated or audited', async () => {
        await build();
        prisma.tenant.findUnique.mockResolvedValue(null);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await app.inject({ method: 'DELETE', url: '/admin/tenants/nope', headers });
        expect(res.statusCode).toBe(404);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(prisma.audits).toHaveLength(0);
    });
    it('deactivates and audits who did it, to which tenant', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        const res = await app.inject({ method: 'DELETE', url: '/admin/tenants/t1', headers });
        expect(res.statusCode).toBe(200);
        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1' }, data: { isActive: false } }));
        expect(prisma.audits.at(-1)).toMatchObject({
            action: 'tenant.deactivated', actorType: 'ADMIN', actorId: row.id, tenantId: 't1', targetType: 'Tenant', targetId: 't1',
            metadata: { wasActive: true },
        });
    });
});

describe('PATCH /admin/users/:id', () => {
    const USER = { id: 'u1', tenantId: 't1', email: 'u@x.com', name: 'Una', role: 'STAFF', isActive: true };
    async function buildUsers() {
        await build();
        prisma.user.findUnique.mockResolvedValue(USER);
        prisma.user.update.mockImplementation(async ({ data }: any) => ({ ...USER, ...data }));
    }
    const patchUser = (role: string, payload: unknown, id = 'u1') => {
        const { headers } = signedInAs(app, prisma, role);
        return app.inject({ method: 'PATCH', url: `/admin/users/${id}`, headers, payload: payload as any });
    };

    it('404 for an unknown user (not a 500)', async () => {
        await buildUsers();
        prisma.user.findUnique.mockResolvedValue(null);
        expect((await patchUser('OWNER', { name: 'Zed' }, 'nope')).statusCode).toBe(404);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('SUPPORT cannot make a tenant user OWNER (403, nothing written); an OWNER admin can', async () => {
        await buildUsers();
        expect((await patchUser('SUPPORT', { role: 'OWNER' })).statusCode).toBe(403);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect((await patchUser('OWNER', { role: 'OWNER' })).statusCode).toBe(200);
        expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('SUPPORT can still make other changes, and every PATCH leaves an audit row with before and after', async () => {
        await buildUsers();
        const res = await patchUser('SUPPORT', { name: 'Una B', isActive: false });
        expect(res.statusCode).toBe(200);
        expect(prisma.audits.at(-1)).toMatchObject({
            action: 'user.updated', actorType: 'ADMIN', actorId: 'admin-support', tenantId: 't1', targetType: 'User', targetId: 'u1',
            metadata: { before: { name: 'Una', isActive: true }, after: { name: 'Una B', isActive: false } },
        });
    });

    it('the audit row records the role change when an OWNER admin promotes, and carries no email', async () => {
        await buildUsers();
        await patchUser('OWNER', { role: 'OWNER' });
        const row = prisma.audits.at(-1);
        expect(row.metadata).toMatchObject({ before: { role: 'STAFF' }, after: { role: 'OWNER' } });
        expect(JSON.stringify(row)).not.toContain('u@x.com');
    });

    it('a refused promotion is not audited as a change and leaves the user alone', async () => {
        await buildUsers();
        await patchUser('FINANCE', { role: 'OWNER' }); // lacks users:write at all
        await patchUser('SUPPORT', { role: 'OWNER' });
        expect(prisma.audits.filter((a) => a.action === 'user.updated')).toHaveLength(0);
    });
});

describe('PATCH /admin/auth/password', () => {
    it('revokes every refresh token the admin holds (family cutoff in Redis)', async () => {
        const m = new Map<string, string>();
        const redis = {
            get: async (k: string) => m.get(k) ?? null,
            set: async (k: string, v: string) => { m.set(k, v); return 'OK'; },
        };
        await build(redis);
        const bcrypt = (await import('bcryptjs')).default;
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT', { passwordHash: await bcrypt.hash('current-password-123', 4) });
        const res = await app.inject({ method: 'PATCH', url: '/admin/auth/password', headers, payload: { currentPassword: 'current-password-123', newPassword: 'a-brand-new-password' } });
        expect(res.statusCode).toBe(200);
        expect(Number(m.get(`admin:rt:since:${row.id}`))).toBeGreaterThan(0);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.password.changed', actorId: row.id });
    });
    it('a wrong current password changes nothing and revokes nothing', async () => {
        const m = new Map<string, string>();
        await build({ get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); return 'OK'; } });
        const bcrypt = (await import('bcryptjs')).default;
        const { headers } = signedInAs(app, prisma, 'SUPPORT', { passwordHash: await bcrypt.hash('current-password-123', 4) });
        const res = await app.inject({ method: 'PATCH', url: '/admin/auth/password', headers, payload: { currentPassword: 'wrong-wrong-wrong', newPassword: 'a-brand-new-password' } });
        expect(res.statusCode).toBe(400);
        expect(m.size).toBe(0);
    });
});
