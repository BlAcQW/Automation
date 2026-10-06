import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import adminManagementRoutes from './admins.js';
import { buildAdminTestApp, makePrisma, signedInAs, adminRow, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

async function build(redis?: any) {
    prisma = makePrisma();
    app = await buildAdminTestApp(async (s) => { await s.register(adminManagementRoutes); }, { prisma, redis });
}

/** Records SET calls so a test can see which admins' sessions were revoked. */
function fakeRedis() {
    const sets: string[] = [];
    return {
        sets,
        set: async (key: string) => { sets.push(key); return 'OK'; },
        get: async () => null,
        del: async () => 1,
        exists: async () => 0,
        incr: async () => 1,
        expire: async () => 1,
    };
}
const newAdmin = { email: 'new@x.com', password: 'a-long-enough-pass', name: 'New Person' };

describe('POST /admin/admins', () => {
    it('OWNER creates an admin with an EXPLICIT role; the legacy flag follows the role', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admin.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }));
        const res = await app.inject({ method: 'POST', url: '/admin/admins', headers, payload: { ...newAdmin, role: 'FINANCE' } });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id: 'n1', role: 'FINANCE', isSuperAdmin: false });
        const data = prisma.admin.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ role: 'FINANCE', isSuperAdmin: false, email: 'new@x.com' });
        expect(data.passwordHash).not.toContain('a-long-enough-pass');
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.created', metadata: { role: 'FINANCE' } });
        expect(JSON.stringify(res.json())).not.toContain('passwordHash');
    });

    it('creating an OWNER sets the legacy flag too', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admin.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }));
        await app.inject({ method: 'POST', url: '/admin/admins', headers, payload: { ...newAdmin, role: 'OWNER' } });
        expect(prisma.admin.create.mock.calls[0][0].data.isSuperAdmin).toBe(true);
    });

    it('the role is required: missing, unknown, lower-case and the legacy flag alone are all 400', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        for (const payload of [
            newAdmin,
            { ...newAdmin, role: 'ROOT' },
            { ...newAdmin, role: 'owner' },
            { ...newAdmin, isSuperAdmin: true },
        ]) {
            const res = await app.inject({ method: 'POST', url: '/admin/admins', headers, payload });
            expect(res.statusCode).toBe(400);
        }
        expect(prisma.admin.create).not.toHaveBeenCalled();
    });

    it('409 on a duplicate email', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('x', adminRow({ id: 'x', email: 'new@x.com' }));
        const res = await app.inject({ method: 'POST', url: '/admin/admins', headers, payload: { ...newAdmin, role: 'SUPPORT' } });
        expect(res.statusCode).toBe(409);
    });

    it.each(['FINANCE', 'SUPPORT', 'READONLY'])('%s cannot create admins', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        const res = await app.inject({ method: 'POST', url: '/admin/admins', headers, payload: { ...newAdmin, role: 'OWNER' } });
        expect(res.statusCode).toBe(403);
        expect(prisma.admin.create).not.toHaveBeenCalled();
    });

    it('a legacy super-admin row with no role can (fallback), a legacy non-super row cannot', async () => {
        await build();
        const legacySuper = signedInAs(app, prisma, 'OWNER', { id: 'legacy-s', role: undefined as any, isSuperAdmin: true });
        const legacyPlain = signedInAs(app, prisma, 'OWNER', { id: 'legacy-p', role: undefined as any, isSuperAdmin: false });
        prisma.admin.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }));
        expect((await app.inject({ method: 'POST', url: '/admin/admins', headers: legacySuper.headers, payload: { ...newAdmin, role: 'SUPPORT' } })).statusCode).toBe(200);
        expect((await app.inject({ method: 'POST', url: '/admin/admins', headers: legacyPlain.headers, payload: { ...newAdmin, email: 'o@x.com', role: 'SUPPORT' } })).statusCode).toBe(403);
    });
});

describe('GET /admin/admins', () => {
    it('lists with role and 2FA state, never secrets', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admin.findMany.mockResolvedValue([]);
        const res = await app.inject({ method: 'GET', url: '/admin/admins', headers });
        expect(res.statusCode).toBe(200);
        const select = prisma.admin.findMany.mock.calls[0][0].select;
        expect(select).toMatchObject({ role: true, totpEnabledAt: true });
        expect(select.passwordHash).toBeUndefined();
        expect(select.totpSecretEnc).toBeUndefined();
        expect(select.recoveryCodeHashes).toBeUndefined();
        expect(prisma.admin.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(200);
    });
    it('SUPPORT is refused', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        expect((await app.inject({ method: 'GET', url: '/admin/admins', headers })).statusCode).toBe(403);
    });
});

describe('PATCH /admin/admins/:id', () => {
    it('changes a role (keeping the legacy flag in step) and audits who/what', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com', role: 'SUPPORT' }));
        const res = await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers, payload: { role: 'OWNER' } });
        expect(res.statusCode).toBe(200);
        expect(prisma.admins.get('t1')).toMatchObject({ role: 'OWNER', isSuperAdmin: true });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.updated', targetId: 't1', metadata: { role: 'OWNER', previousRole: 'SUPPORT' } });
    });

    it('an OWNER cannot change their own role or deactivate themselves', async () => {
        await build();
        const { row, headers } = signedInAs(app, prisma, 'OWNER');
        const demote = await app.inject({ method: 'PATCH', url: `/admin/admins/${row.id}`, headers, payload: { role: 'READONLY' } });
        expect(demote.statusCode).toBe(400);
        const off = await app.inject({ method: 'PATCH', url: `/admin/admins/${row.id}`, headers, payload: { isActive: false } });
        expect(off.statusCode).toBe(400);
        expect(prisma.admins.get(row.id)!.role).toBe('OWNER');
    });

    it('refuses to demote or deactivate the last active OWNER', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('o2', adminRow({ id: 'o2', email: 'o2@x.com', role: 'OWNER', isSuperAdmin: true }));
        prisma.admin.count.mockResolvedValue(1); // only o2 would remain... i.e. caller is not counted as "another"
        const res = await app.inject({ method: 'PATCH', url: '/admin/admins/o2', headers, payload: { role: 'SUPPORT' } });
        // caller (OWNER) exists, so there is another active owner: allowed
        expect(res.statusCode).toBe(200);
        prisma.admin.count.mockResolvedValue(0);
        prisma.admins.set('o2', adminRow({ id: 'o2', email: 'o2@x.com', role: 'OWNER', isSuperAdmin: true }));
        const res2 = await app.inject({ method: 'PATCH', url: '/admin/admins/o2', headers, payload: { isActive: false } });
        expect(res2.statusCode).toBe(400);
        expect(res2.json().message).toMatch(/last/i);
    });

    it('404 for an unknown admin, 400 for an empty or unknown-field body, 403 for non-OWNER', async () => {
        await build();
        const owner = signedInAs(app, prisma, 'OWNER');
        expect((await app.inject({ method: 'PATCH', url: '/admin/admins/nope', headers: owner.headers, payload: { role: 'SUPPORT' } })).statusCode).toBe(404);
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com' }));
        expect((await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers: owner.headers, payload: {} })).statusCode).toBe(400);
        expect((await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers: owner.headers, payload: { passwordHash: 'x' } })).statusCode).toBe(400);
        const support = signedInAs(app, prisma, 'SUPPORT');
        expect((await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers: support.headers, payload: { role: 'OWNER' } })).statusCode).toBe(403);
    });
});

describe('POST /admin/admins/:id/reset-2fa', () => {
    it('OWNER clears another admin\'s 2FA (lost device) and it is audited', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com', totpEnabledAt: new Date(), totpSecretEnc: 'enc', recoveryCodeHashes: ['h'] }));
        const res = await app.inject({ method: 'POST', url: '/admin/admins/t1/reset-2fa', headers });
        expect(res.statusCode).toBe(200);
        expect(prisma.admins.get('t1')).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, recoveryCodeHashes: [] });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.2fa.reset', targetId: 't1' });
    });
    it('not for yourself (use the normal flow), not for non-OWNER', async () => {
        await build();
        const owner = signedInAs(app, prisma, 'OWNER');
        expect((await app.inject({ method: 'POST', url: `/admin/admins/${owner.row.id}/reset-2fa`, headers: owner.headers })).statusCode).toBe(400);
        const fin = signedInAs(app, prisma, 'FINANCE');
        expect((await app.inject({ method: 'POST', url: '/admin/admins/x/reset-2fa', headers: fin.headers })).statusCode).toBe(403);
    });
});

describe('admin creation password policy', () => {
    it('needs at least 12 characters (same as the self-service change)', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admin.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }));
        const short = await app.inject({ method: 'POST', url: '/admin/admins', headers, payload: { ...newAdmin, password: 'elevenchars', role: 'SUPPORT' } });
        expect(short.statusCode).toBe(400);
        expect(prisma.admin.create).not.toHaveBeenCalled();
        const ok = await app.inject({ method: 'POST', url: '/admin/admins', headers, payload: { ...newAdmin, password: 'twelve-chars', role: 'SUPPORT' } });
        expect(ok.statusCode).toBe(200);
    });
});

describe('PATCH /admin/admins/:id: last-OWNER invariant under concurrency', () => {
    function serialiseTransactions() {
        // A real database serialises two transactions that both lock the owner rows;
        // model that with a queue.
        let chain: Promise<unknown> = Promise.resolve();
        prisma.$transaction.mockImplementation((arg: any) => {
            const run = chain.then(() => arg(prisma));
            chain = run.catch(() => undefined);
            return run;
        });
        prisma.admin.count.mockImplementation(async ({ where }: any) =>
            [...prisma.admins.values()].filter((a) => a.role === 'OWNER' && a.isActive && a.id !== where.id.not).length);
    }

    it('runs in a transaction that locks the owner rows before reading or writing', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com', role: 'OWNER', isSuperAdmin: true }));
        serialiseTransactions();
        const order: string[] = [];
        prisma.$queryRaw.mockImplementation(async (strings: any) => { order.push(`lock:${String(strings.join?.('') ?? strings)}`); return []; });
        const update = prisma.admin.update.getMockImplementation()!;
        prisma.admin.update.mockImplementation(async (a: any) => { order.push('update'); return update(a); });
        const res = await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers, payload: { role: 'SUPPORT' } });
        expect(res.statusCode).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(order[0]).toMatch(/lock:.*FOR UPDATE/);
        expect(order.indexOf('update')).toBeGreaterThan(0);
    });

    it('two OWNERs demoting each other at the same time cannot leave zero owners', async () => {
        await build();
        const a = signedInAs(app, prisma, 'OWNER'); // admin-owner
        prisma.admins.set('o2', adminRow({ id: 'o2', email: 'o2@x.com', role: 'OWNER', isSuperAdmin: true }));
        const { adminAccessToken, bearer } = await import('./test-kit.js');
        const bHeaders = bearer(adminAccessToken(app, 'o2'));
        serialiseTransactions();
        const [r1, r2] = await Promise.all([
            app.inject({ method: 'PATCH', url: '/admin/admins/o2', headers: a.headers, payload: { role: 'READONLY' } }),
            app.inject({ method: 'PATCH', url: `/admin/admins/${a.row.id}`, headers: bHeaders, payload: { role: 'READONLY' } }),
        ]);
        const owners = [...prisma.admins.values()].filter((x) => x.role === 'OWNER' && x.isActive);
        expect(owners).toHaveLength(1);
        expect([r1.statusCode, r2.statusCode].filter((c) => c === 200)).toHaveLength(1);
        expect([r1.statusCode, r2.statusCode].filter((c) => c >= 400)).toHaveLength(1);
    });

    it('an actor who lost OWNER while waiting for the lock is refused', async () => {
        await build();
        const a = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com', role: 'SUPPORT' }));
        serialiseTransactions();
        // demoted between authentication and the transaction
        prisma.$queryRaw.mockImplementationOnce(async () => {
            prisma.admins.set(a.row.id, { ...prisma.admins.get(a.row.id)!, role: 'READONLY' });
            return [];
        });
        const res = await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers: a.headers, payload: { role: 'OWNER' } });
        expect(res.statusCode).toBe(403);
        expect(prisma.admins.get('t1')!.role).toBe('SUPPORT');
    });
});

describe('changing an admin signs them out everywhere', () => {
    it.each([[{ role: 'READONLY' }], [{ isActive: false }]])('PATCH %o revokes the target\'s refresh tokens', async (payload) => {
        const redis = fakeRedis();
        await build(redis);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com', role: 'SUPPORT' }));
        const res = await app.inject({ method: 'PATCH', url: '/admin/admins/t1', headers, payload });
        expect(res.statusCode).toBe(200);
        expect(redis.sets.some((k) => k.endsWith('since:t1'))).toBe(true);
    });

    it('reset-2fa revokes the target\'s refresh tokens', async () => {
        const redis = fakeRedis();
        await build(redis);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.admins.set('t1', adminRow({ id: 't1', email: 't1@x.com', totpEnabledAt: new Date(), totpSecretEnc: 'enc', recoveryCodeHashes: ['h'] }));
        const res = await app.inject({ method: 'POST', url: '/admin/admins/t1/reset-2fa', headers });
        expect(res.statusCode).toBe(200);
        expect(redis.sets.some((k) => k.endsWith('since:t1'))).toBe(true);
    });
});
