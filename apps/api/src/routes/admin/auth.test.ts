import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config/index.js';
import csrfPlugin, { CSRF_HEADER } from '../../plugins/csrf.js';
import { encrypt } from '../../services/crypto.js';
import {
    generateTotpSecret,
    totpAt,
    hashRecoveryCode,
    resetTotpGuards,
} from '../../services/admin-totp.js';
import { emailTag } from '../../services/admin-throttle.js';
import { clearSwitchCache } from '../../services/platform-switches.js';
import adminAuthRoutes from './auth.js';
import {
    adminRow, buildAdminTestApp, makePrisma, adminAccessToken, adminRefreshToken, bearer, signedInAs,
    type PrismaStub,
} from './test-kit.js';

const original = { crossSiteAuth: config.crossSiteAuth, nodeEnv: config.nodeEnv, corsOrigins: config.corsOrigins };
const PASSWORD = 'correct-horse-battery';
let passwordHash: string;
let prisma: PrismaStub;
let redis: any;
let app: FastifyInstance;

function fakeRedis() {
    const m = new Map<string, string>();
    return {
        m,
        get: async (k: string) => m.get(k) ?? null,
        set: async (k: string, v: string, ...a: any[]) => { if (a.includes('NX') && m.has(k)) return null; m.set(k, v); return 'OK'; },
        incr: async (k: string) => { const n = Number(m.get(k) ?? 0) + 1; m.set(k, String(n)); return n; },
        expire: async () => 1,
        del: async (...ks: string[]) => { ks.forEach((k) => m.delete(k)); return ks.length; },
    };
}

async function build(opts: { csrf?: boolean } = {}) {
    prisma = makePrisma();
    redis = fakeRedis();
    app = await buildAdminTestApp(async (scope) => {
        if (opts.csrf) await scope.register(fp(async (a) => { await a.register(csrfPlugin, { enabled: true, origins: ['https://console.example.org'] }); }));
        await scope.register(adminAuthRoutes);
    }, { prisma, redis });
    return app;
}

beforeEach(async () => {
    passwordHash ??= await bcrypt.hash(PASSWORD, 4);
    resetTotpGuards();
    clearSwitchCache();
});
afterEach(async () => {
    Object.assign(config, original);
    await app?.close();
});

const login = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/admin/auth/login', payload });
const seed = (over: Record<string, unknown> = {}) => {
    const row = adminRow({ passwordHash, ...over } as any);
    prisma.admins.set(row.id, row);
    return row;
};
const cookieHeader = (res: any) => String(res.headers['set-cookie'] ?? '');

describe('POST /admin/auth/login', () => {
    it('signs in, returns role + token, sets the refresh cookie scoped to /admin/auth, audits success', async () => {
        await build();
        seed({ role: 'FINANCE' });
        const res = await login({ email: 'a@x.com', password: PASSWORD });
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j.accessToken).toBeTruthy();
        expect(j.admin).toMatchObject({ id: 'admin-1', role: 'FINANCE', totpEnabled: false });
        expect(j.admin.passwordHash).toBeUndefined();
        const c = cookieHeader(res);
        expect(c).toMatch(/^adminRefreshToken=/);
        expect(c).toMatch(/HttpOnly/);
        expect(c).toMatch(/Path=\/admin\/auth/);
        expect(c).toMatch(/SameSite=Lax/);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.login.success', actorType: 'ADMIN', actorId: 'admin-1' });
    });

    it('wrong password and unknown email both give the same 401, and the failure is audited', async () => {
        await build();
        seed();
        const bad = await login({ email: 'a@x.com', password: 'nope-nope-nope' });
        const unknown = await login({ email: 'ghost@x.com', password: PASSWORD });
        expect(bad.statusCode).toBe(401);
        expect(unknown.statusCode).toBe(401);
        expect(bad.json().message).toBe(unknown.json().message);
        expect(prisma.audits.filter((a) => a.action === 'admin.login.failure')).toHaveLength(2);
        expect(cookieHeader(bad)).toBe('');
    });

    it('the audit row keeps the typed email only for a real admin; strangers get a keyed tag', async () => {
        await build();
        seed();
        await login({ email: 'ghost@x.com', password: PASSWORD });
        await login({ email: 'a@x.com', password: 'nope-nope-nope' });
        const [ghost, real] = prisma.audits.filter((a) => a.action === 'admin.login.failure');
        expect(JSON.stringify(ghost)).not.toContain('ghost@x.com');
        expect(ghost.metadata).toMatchObject({ reason: 'unknown_email', emailTag: emailTag('ghost@x.com') });
        expect(ghost.actorId).toBeNull();
        expect(real.metadata).toMatchObject({ reason: 'bad_password', email: 'a@x.com' });
    });

    it('per-account throttle: 5 wrong passwords lock the account for every IP, even for the right password', async () => {
        await build();
        seed();
        for (let i = 0; i < 5; i++) {
            const r = await app.inject({ method: 'POST', url: '/admin/auth/login', remoteAddress: `10.0.0.${i + 1}`, payload: { email: 'a@x.com', password: 'nope-nope-nope' } });
            expect(r.statusCode).toBe(401);
        }
        const locked = await app.inject({ method: 'POST', url: '/admin/auth/login', remoteAddress: '10.9.9.9', payload: { email: 'a@x.com', password: PASSWORD } });
        expect(locked.statusCode).toBe(429);
        expect(cookieHeader(locked)).toBe('');
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.login.failure', metadata: { reason: 'account_locked' } });
    });

    it('the throttle also counts unknown emails (no oracle on which admins exist) and a success clears the counter', async () => {
        await build();
        seed();
        for (let i = 0; i < 5; i++) await login({ email: 'ghost@x.com', password: 'whatever-whatever' });
        expect((await login({ email: 'ghost@x.com', password: 'whatever-whatever' })).statusCode).toBe(429);
        for (let i = 0; i < 4; i++) await login({ email: 'a@x.com', password: 'nope-nope-nope' });
        expect((await login({ email: 'a@x.com', password: PASSWORD })).statusCode).toBe(200);
        for (let i = 0; i < 4; i++) await login({ email: 'a@x.com', password: 'nope-nope-nope' });
        expect((await login({ email: 'a@x.com', password: PASSWORD })).statusCode).toBe(200);
    });

    it('a deactivated admin cannot sign in', async () => {
        await build();
        seed({ isActive: false });
        expect((await login({ email: 'a@x.com', password: PASSWORD })).statusCode).toBe(401);
    });

    describe('with 2FA enabled', () => {
        const secret = generateTotpSecret();
        const enabled = (over: Record<string, unknown> = {}) =>
            seed({ totpSecretEnc: encrypt(secret), totpEnabledAt: new Date(), ...over });

        it('without a code: 401 asking for it, no token, no cookie', async () => {
            await build();
            enabled();
            const res = await login({ email: 'a@x.com', password: PASSWORD });
            expect(res.statusCode).toBe(401);
            expect(res.json()).toMatchObject({ totpRequired: true });
            expect(res.json().accessToken).toBeUndefined();
            expect(cookieHeader(res)).toBe('');
        });

        it('a wrong code is refused and audited; the right password alone is not enough', async () => {
            await build();
            enabled();
            const res = await login({ email: 'a@x.com', password: PASSWORD, code: '000000' });
            expect(res.statusCode).toBe(401);
            expect(res.json().message).toMatch(/two-factor/i);
            expect(res.json().accessToken).toBeUndefined();
            expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.login.failure', metadata: expect.objectContaining({ reason: 'bad_totp' }) });
        });

        it('the wrong password is rejected BEFORE the code is even considered (no 2FA oracle)', async () => {
            await build();
            enabled();
            const res = await login({ email: 'a@x.com', password: 'wrong-wrong-wrong' });
            expect(res.statusCode).toBe(401);
            expect(res.json().totpRequired).toBeUndefined();
        });

        it('the right code signs in', async () => {
            await build();
            enabled();
            const res = await login({ email: 'a@x.com', password: PASSWORD, code: totpAt(secret, Date.now()) });
            expect(res.statusCode).toBe(200);
            expect(res.json().admin.totpEnabled).toBe(true);
        });

        it('a recovery code signs in once; the atomic consume decides', async () => {
            await build();
            const rc = 'abcde-fghjk';
            enabled({ recoveryCodeHashes: [hashRecoveryCode(rc)] });
            prisma.$executeRaw.mockResolvedValueOnce(1);
            prisma.$executeRaw.mockResolvedValueOnce(0);
            const first = await login({ email: 'a@x.com', password: PASSWORD, code: rc });
            expect(first.statusCode).toBe(200);
            expect(prisma.audits.find((a) => a.action === 'admin.login.success')?.metadata).toMatchObject({ method: 'recovery' });
            const second = await login({ email: 'a@x.com', password: PASSWORD, code: rc });
            expect(second.statusCode).toBe(401);
        });

        it('6 wrong codes -> 429', async () => {
            await build();
            enabled();
            for (let i = 0; i < 5; i++) await login({ email: 'a@x.com', password: PASSWORD, code: '000000' });
            const res = await login({ email: 'a@x.com', password: PASSWORD, code: totpAt(secret, Date.now()) });
            expect(res.statusCode).toBe(429);
        });
    });

    it('reports when the platform requires 2FA and this admin has none', async () => {
        await build();
        seed();
        prisma.platformSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
        const res = await login({ email: 'a@x.com', password: PASSWORD });
        expect(res.statusCode).toBe(200);
        expect(res.json().twoFactor).toEqual({ required: true, enrolled: false });
    });
});

describe('POST /admin/auth/refresh', () => {
    const refresh = (token?: string, headers: Record<string, string> = {}) =>
        app.inject({
            method: 'POST', url: '/admin/auth/refresh',
            headers: { ...(token ? { cookie: `adminRefreshToken=${token}` } : {}), ...headers },
        });

    it('exchanges a valid refresh cookie for a new access token AND a rotated cookie', async () => {
        await build();
        seed();
        const old = adminRefreshToken(app, 'admin-1', 'jti-old');
        const res = await refresh(old);
        expect(res.statusCode).toBe(200);
        expect(res.json().accessToken).toBeTruthy();
        const c = cookieHeader(res);
        expect(c).toMatch(/^adminRefreshToken=/);
        expect(c).not.toContain(old);
        expect(c).toMatch(/Path=\/admin\/auth/);
        // the new access token works
        const me = await app.inject({ method: 'GET', url: '/admin/auth/me', headers: bearer(res.json().accessToken) });
        expect(me.statusCode).toBe(200);
    });

    it('401 and a cleared cookie with no cookie / garbage / an access token in the cookie', async () => {
        await build();
        seed();
        expect((await refresh()).statusCode).toBe(401);
        const garbage = await refresh('not.a.jwt');
        expect(garbage.statusCode).toBe(401);
        expect(cookieHeader(garbage)).toMatch(/adminRefreshToken=;/);
        const wrongType = await refresh(adminAccessToken(app, 'admin-1'));
        expect(wrongType.statusCode).toBe(401);
    });

    it('401 for a deactivated or deleted admin', async () => {
        await build();
        seed({ isActive: false });
        expect((await refresh(adminRefreshToken(app, 'admin-1'))).statusCode).toBe(401);
        expect((await refresh(adminRefreshToken(app, 'gone'))).statusCode).toBe(401);
    });

    it('a user (tenant) refresh token is not an admin refresh token', async () => {
        await build();
        seed();
        const userToken = (app as any).jwt.sign({ userId: 'u', tenantId: 't', role: 'OWNER', type: 'refresh' }, { expiresIn: '7d' });
        expect((await refresh(userToken)).statusCode).toBe(401);
    });

    it('a logged-out token is refused afterwards', async () => {
        await build();
        seed();
        const t = adminRefreshToken(app, 'admin-1', 'jti-out');
        const out = await app.inject({ method: 'POST', url: '/admin/auth/logout', headers: { cookie: `adminRefreshToken=${t}` } });
        expect(out.statusCode).toBe(200);
        expect((await refresh(t)).statusCode).toBe(401);
    });

    it('reuse of a rotated token after the grace window is refused', async () => {
        await build();
        seed();
        const t = adminRefreshToken(app, 'admin-1', 'jti-reuse');
        expect((await refresh(t)).statusCode).toBe(200);
        // age the "used" mark beyond the grace window
        redis.m.set('admin:rt:used:jti-reuse', String(Date.now() - 60_000));
        expect((await refresh(t)).statusCode).toBe(401);
    });

    it('a reuse beyond the grace window revokes the whole family: a sibling token dies too, and it is audited', async () => {
        await build();
        seed();
        const stolen = adminRefreshToken(app, 'admin-1', 'jti-a', '7d', 'fam-x');
        const sibling = adminRefreshToken(app, 'admin-1', 'jti-b', '7d', 'fam-x');
        const otherSignIn = adminRefreshToken(app, 'admin-1', 'jti-c', '7d', 'fam-y');
        expect((await refresh(stolen)).statusCode).toBe(200);
        redis.m.set('admin:rt:used:jti-a', String(Date.now() - 60_000));
        expect((await refresh(stolen)).statusCode).toBe(401);
        expect((await refresh(sibling)).statusCode).toBe(401);
        expect((await refresh(otherSignIn)).statusCode).toBe(200);
        expect(prisma.audits.find((a) => a.action === 'admin.refresh.reuse_refused')).toBeTruthy();
    });

    it('the rotated cookie keeps the family of the token it replaced', async () => {
        await build();
        seed();
        const res = await refresh(adminRefreshToken(app, 'admin-1', 'jti-f', '7d', 'fam-keep'));
        const cookie = /adminRefreshToken=([^;]+)/.exec(cookieHeader(res))![1];
        expect((app as any).jwt.admin.decode(cookie)).toMatchObject({ fam: 'fam-keep', type: 'admin_refresh' });
        expect((app as any).jwt.admin.decode(cookie).jti).not.toBe('jti-f');
    });

    it('login starts a new family each time', async () => {
        await build();
        seed();
        const fam = async () => {
            const res = await login({ email: 'a@x.com', password: PASSWORD });
            return (app as any).jwt.admin.decode(/adminRefreshToken=([^;]+)/.exec(cookieHeader(res))![1]).fam;
        };
        const a = await fam();
        const b = await fam();
        expect(a).toBeTruthy();
        expect(a).not.toBe(b);
    });

    it('refuses a token with no jti or no family (pre-deploy tokens): everyone signs in again once', async () => {
        await build();
        seed();
        const noJti = (app as any).jwt.admin.sign({ adminId: 'admin-1', type: 'admin_refresh' }, { expiresIn: '7d' });
        expect((await refresh(noJti)).statusCode).toBe(401);
        const jtiOnly = (app as any).jwt.admin.sign({ adminId: 'admin-1', type: 'admin_refresh', jti: 'old' }, { expiresIn: '7d' });
        expect((await refresh(jtiOnly)).statusCode).toBe(401);
        const noRedis = makePrisma();
        await app.close();
        app = await buildAdminTestApp(async (s) => { await s.register(adminAuthRoutes); }, { prisma: noRedis, redis: null });
        noRedis.admins.set('admin-1', adminRow({ passwordHash }));
        expect((await refresh((app as any).jwt.admin.sign({ adminId: 'admin-1', type: 'admin_refresh' }, { expiresIn: '7d' }))).statusCode).toBe(401);
    });

    it('a revokeAll cutoff for the admin refuses older refresh tokens', async () => {
        await build();
        seed();
        redis.m.set('admin:rt:since:admin-1', String(Math.floor(Date.now() / 1000) + 5));
        expect((await refresh(adminRefreshToken(app, 'admin-1', 'jti-cut'))).statusCode).toBe(401);
    });

    it('production without Redis refuses refresh (fail closed) unless ADMIN_REFRESH_ALLOW_NO_REDIS=true', async () => {
        prisma = makePrisma();
        app = await buildAdminTestApp(async (s) => { await s.register(adminAuthRoutes); }, { prisma, redis: null });
        seed();
        (config as any).nodeEnv = 'production';
        const t = adminRefreshToken(app, 'admin-1', 'jti-prod');
        const closed = await refresh(t);
        expect(closed.statusCode).toBe(401);
        expect(cookieHeader(closed)).toMatch(/adminRefreshToken=;/);
        process.env.ADMIN_REFRESH_ALLOW_NO_REDIS = 'true';
        try {
            expect((await refresh(t)).statusCode).toBe(200);
        } finally {
            delete process.env.ADMIN_REFRESH_ALLOW_NO_REDIS;
        }
    });

    it('a Redis error during refresh refuses (fail closed) instead of 500', async () => {
        await build();
        seed();
        redis.get = async () => { throw new Error('redis down'); };
        expect((await refresh(adminRefreshToken(app, 'admin-1', 'jti-err'))).statusCode).toBe(401);
    });

    it('works with no redis outside production (token expiry is then the only limit)', async () => {
        prisma = makePrisma();
        app = await buildAdminTestApp(async (s) => { await s.register(adminAuthRoutes); }, { prisma, redis: null });
        seed();
        expect((await refresh(adminRefreshToken(app, 'admin-1'))).statusCode).toBe(200);
    });

    it('a demoted admin gets the NEW role on the next refresh (role is read from the row)', async () => {
        await build();
        seed({ role: 'OWNER' });
        prisma.admins.set('admin-1', { ...prisma.admins.get('admin-1')!, role: 'READONLY' });
        const res = await refresh(adminRefreshToken(app, 'admin-1'));
        const me = await app.inject({ method: 'GET', url: '/admin/auth/me', headers: bearer(res.json().accessToken) });
        expect(me.json().role).toBe('READONLY');
    });
});

describe('cross-site cookies and CSRF (D7 helpers)', () => {
    it('flag on: login, refresh and logout cookies are SameSite=None; Secure; HttpOnly', async () => {
        (config as any).crossSiteAuth = true;
        (config as any).nodeEnv = 'production';
        await build();
        seed();
        const li = await login({ email: 'a@x.com', password: PASSWORD });
        expect(cookieHeader(li)).toMatch(/SameSite=None/);
        expect(cookieHeader(li)).toMatch(/Secure/);
        expect(cookieHeader(li)).toMatch(/HttpOnly/);
        const rf = await app.inject({ method: 'POST', url: '/admin/auth/refresh', headers: { cookie: `adminRefreshToken=${adminRefreshToken(app, 'admin-1')}` } });
        expect(cookieHeader(rf)).toMatch(/SameSite=None/);
        expect(cookieHeader(rf)).toMatch(/Secure/);
        const lo = await app.inject({ method: 'POST', url: '/admin/auth/logout', headers: { cookie: `adminRefreshToken=x` } });
        expect(cookieHeader(lo)).toMatch(/adminRefreshToken=;/);
        expect(cookieHeader(lo)).toMatch(/SameSite=None/);
        expect(cookieHeader(lo)).toMatch(/Secure/);
    });

    it('flag off: legacy attributes (Lax), logout clears with just the path', async () => {
        (config as any).crossSiteAuth = false;
        await build();
        seed();
        const li = await login({ email: 'a@x.com', password: PASSWORD });
        expect(cookieHeader(li)).toMatch(/SameSite=Lax/);
        const lo = await app.inject({ method: 'POST', url: '/admin/auth/logout' });
        expect(cookieHeader(lo)).toMatch(/adminRefreshToken=;/);
        expect(cookieHeader(lo)).not.toMatch(/SameSite=None/);
    });

    it('with CSRF on, a cookie-bearing refresh from a foreign origin is rejected before the handler', async () => {
        (config as any).crossSiteAuth = true;
        await build({ csrf: true });
        seed();
        const t = adminRefreshToken(app, 'admin-1');
        const bad = await app.inject({ method: 'POST', url: '/admin/auth/refresh', headers: { cookie: `adminRefreshToken=${t}`, origin: 'https://evil.example' } });
        expect(bad.statusCode).toBe(403);
        const good = await app.inject({
            method: 'POST', url: '/admin/auth/refresh',
            headers: { cookie: `adminRefreshToken=${t}`, origin: 'https://console.example.org', [CSRF_HEADER]: 'XMLHttpRequest' },
        });
        expect(good.statusCode).toBe(200);
    });
});

describe('GET /admin/auth/me', () => {
    it('returns role, permissions, 2FA state and the platform requirement', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const res = await app.inject({ method: 'GET', url: '/admin/auth/me', headers });
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j).toMatchObject({ role: 'SUPPORT', totpEnabled: false, twoFactorRequired: false });
        expect(j.permissions).toContain('support:access');
        expect(j.permissions).not.toContain('money:read');
        expect(j.passwordHash).toBeUndefined();
        expect(j.totpSecretEnc).toBeUndefined();
    });
    it('401 without a token', async () => {
        await build();
        expect((await app.inject({ method: 'GET', url: '/admin/auth/me' })).statusCode).toBe(401);
    });
});

describe('2FA self-service', () => {
    it('enrol needs the password, returns the secret + URI once, and stores only ciphertext', async () => {
        await build();
        const { row, headers } = signedInAs(app, prisma, 'OWNER', { passwordHash });
        const bad = await app.inject({ method: 'POST', url: '/admin/auth/2fa/enrol', headers, payload: { password: 'wrong-wrong-wrong' } });
        expect(bad.statusCode).toBe(400);
        const ok = await app.inject({ method: 'POST', url: '/admin/auth/2fa/enrol', headers, payload: { password: PASSWORD } });
        expect(ok.statusCode).toBe(200);
        const { secret, otpauthUri } = ok.json();
        expect(otpauthUri).toContain(`secret=${secret}`);
        const stored = prisma.admins.get(row.id)!;
        expect(stored.totpSecretEnc).toBeTruthy();
        expect(stored.totpSecretEnc).not.toContain(secret);
        expect(stored.totpEnabledAt).toBeNull();
    });

    it('verify enables 2FA and returns the recovery codes exactly once', async () => {
        await build();
        const secret = generateTotpSecret();
        const { row, headers } = signedInAs(app, prisma, 'OWNER', { totpSecretEnc: encrypt(secret) });
        const wrong = await app.inject({ method: 'POST', url: '/admin/auth/2fa/verify', headers, payload: { code: '000000' } });
        expect(wrong.statusCode).toBe(400);
        const ok = await app.inject({ method: 'POST', url: '/admin/auth/2fa/verify', headers, payload: { code: totpAt(secret, Date.now()) } });
        expect(ok.statusCode).toBe(200);
        expect(ok.json().recoveryCodes).toHaveLength(10);
        expect(prisma.admins.get(row.id)!.totpEnabledAt).toBeInstanceOf(Date);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.2fa.enabled' });
        expect(JSON.stringify(prisma.audits)).not.toContain(ok.json().recoveryCodes[0]);
    });

    it('a READONLY admin can still enrol (self is exempt from the GET-only rule)', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY', { passwordHash });
        const res = await app.inject({ method: 'POST', url: '/admin/auth/2fa/enrol', headers, payload: { password: PASSWORD } });
        expect(res.statusCode).toBe(200);
    });

    it('disable needs password AND a current code, and is refused while the platform requires 2FA', async () => {
        await build();
        const secret = generateTotpSecret();
        const { row, headers } = signedInAs(app, prisma, 'OWNER', { passwordHash, totpSecretEnc: encrypt(secret), totpEnabledAt: new Date() });
        const noCode = await app.inject({ method: 'POST', url: '/admin/auth/2fa/disable', headers, payload: { password: PASSWORD, code: '000000' } });
        expect(noCode.statusCode).toBe(400);
        expect(prisma.admins.get(row.id)!.totpEnabledAt).not.toBeNull();

        clearSwitchCache(); // the policy read above is cached for a few seconds
        prisma.platformSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
        const required = await app.inject({ method: 'POST', url: '/admin/auth/2fa/disable', headers, payload: { password: PASSWORD, code: totpAt(secret, Date.now()) } });
        expect(required.statusCode).toBe(400);
        expect(required.json().message).toMatch(/required/i);

        clearSwitchCache();
        prisma.platformSetting.findUnique.mockResolvedValue(null);
        const ok = await app.inject({ method: 'POST', url: '/admin/auth/2fa/disable', headers, payload: { password: PASSWORD, code: totpAt(secret, Date.now() + 30_000) } });
        expect(ok.statusCode).toBe(200);
        expect(prisma.admins.get(row.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [] });
    });
});

describe('2FA disable under the require-2FA policy', () => {
    it('is refused BEFORE the recovery code is consumed', async () => {
        await build();
        const secret = generateTotpSecret();
        const recovery = 'abcde-fghjk';
        const { row, headers } = signedInAs(app, prisma, 'OWNER', {
            passwordHash, totpSecretEnc: encrypt(secret), totpEnabledAt: new Date(), recoveryCodeHashes: [hashRecoveryCode(recovery)],
        });
        prisma.platformSetting.findUnique.mockResolvedValue({ value: { enabled: true } });
        const res = await app.inject({ method: 'POST', url: '/admin/auth/2fa/disable', headers, payload: { password: PASSWORD, code: recovery } });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/required/i);
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
        expect(prisma.admins.get(row.id)!.recoveryCodeHashes).toHaveLength(1);
    });
});

describe('PUT /admin/security/two-factor (OWNER policy)', () => {
    it('only an OWNER may set it', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const res = await app.inject({ method: 'PUT', url: '/admin/security/two-factor', headers, payload: { required: true } });
        expect(res.statusCode).toBe(403);
    });

    it('an OWNER without 2FA cannot require it (would lock themselves out)', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await app.inject({ method: 'PUT', url: '/admin/security/two-factor', headers, payload: { required: true } });
        expect(res.statusCode).toBe(400);
        expect(prisma.platformSetting.upsert).not.toHaveBeenCalled();
    });

    it('an OWNER with 2FA can require it, audited', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER', { totpEnabledAt: new Date(), totpSecretEnc: encrypt('X') });
        const res = await app.inject({ method: 'PUT', url: '/admin/security/two-factor', headers, payload: { required: true } });
        expect(res.statusCode).toBe(200);
        expect(prisma.platformSetting.upsert.mock.calls[0][0].create).toMatchObject({ key: 'admin.require2fa', value: { enabled: true } });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'admin.2fa.policy_changed', metadata: { required: true } });
    });
});
