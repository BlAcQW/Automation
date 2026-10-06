import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import bcrypt from 'bcryptjs';
import errorHandler from '../../plugins/error-handler.js';
import csrfPlugin, { CSRF_HEADER } from '../../plugins/csrf.js';
import authRoutes from './index.js';
import { config } from '../../config/index.js';

vi.mock('../../services/audit.js', () => ({ audit: vi.fn(async () => undefined) }));
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => null,
    sendEmail: vi.fn(async () => ({ ok: true })),
}));

const original = { crossSiteAuth: config.crossSiteAuth, nodeEnv: config.nodeEnv, corsOrigins: config.corsOrigins };

async function build(crossSite: boolean, nodeEnv: 'development' | 'production' = 'production') {
    (config as any).crossSiteAuth = crossSite;
    (config as any).nodeEnv = nodeEnv;
    (config as any).corsOrigins = ['https://console.example.org'];
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    const app = Fastify();
    app.decorate('jwt', { sign: () => 'signed.jwt.token', verify: () => ({ userId: 'u1', tenantId: 't1', role: 'OWNER', type: 'refresh' }) } as any);
    app.decorate('authenticate', async () => undefined);
    app.decorate('prisma', {
        user: {
            findFirst: async () => ({
                id: 'u1', tenantId: 't1', email: 'a@b.co', name: 'A', role: 'OWNER', isActive: true, passwordHash,
                tenant: { id: 't1', name: 'T', businessType: 'SERVICE', timezone: 'UTC', isActive: true },
            }),
            findUnique: async () => ({
                id: 'u1', tenantId: 't1', role: 'OWNER', isActive: true, tenant: { isActive: true },
            }),
        },
    } as any);
    await app.register(cookie);
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(csrfPlugin);
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
    return app;
}

const login = (app: Awaited<ReturnType<typeof build>>) =>
    app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@b.co', password: 'correct-horse' } });

afterEach(() => {
    Object.assign(config, original);
});

describe('refresh cookie attributes on the real /auth routes', () => {
    it('default (flag off): HttpOnly; SameSite=Lax; Secure in production; Path=/', async () => {
        const res = await login(await build(false));
        expect(res.statusCode).toBe(200);
        const c = String(res.headers['set-cookie']);
        expect(c).toMatch(/^refreshToken=/);
        expect(c).toMatch(/HttpOnly/);
        expect(c).toMatch(/SameSite=Lax/);
        expect(c).toMatch(/Secure/);
        expect(c).toMatch(/Path=\//);
        expect(c).toMatch(/Max-Age=604800/);
    });

    it('default (flag off) outside production: Lax and not Secure, as today', async () => {
        const res = await login(await build(false, 'development'));
        const c = String(res.headers['set-cookie']);
        expect(c).toMatch(/SameSite=Lax/);
        expect(c).not.toMatch(/Secure/);
    });

    it('flag on: HttpOnly; SameSite=None; Secure', async () => {
        const res = await login(await build(true));
        const c = String(res.headers['set-cookie']);
        expect(c).toMatch(/HttpOnly/);
        expect(c).toMatch(/SameSite=None/);
        expect(c).toMatch(/Secure/);
    });

    it('logout clears with the legacy attributes when off, and SameSite=None; Secure when on', async () => {
        const off = await (await build(false)).inject({ method: 'POST', url: '/auth/logout' });
        expect(String(off.headers['set-cookie'])).toMatch(/^refreshToken=;/);
        expect(String(off.headers['set-cookie'])).not.toMatch(/SameSite/);

        const app = await build(true);
        const on = await app.inject({
            method: 'POST', url: '/auth/logout',
            headers: { cookie: 'refreshToken=x', origin: 'https://console.example.org', [CSRF_HEADER]: 'XMLHttpRequest' },
        });
        expect(on.statusCode).toBe(200);
        expect(String(on.headers['set-cookie'])).toMatch(/SameSite=None/);
        expect(String(on.headers['set-cookie'])).toMatch(/Secure/);
    });
});

describe('CSRF on the real /auth/refresh and /auth/logout', () => {
    const cases: Array<[string, Record<string, string>, number]> = [
        ['allowed origin + header', { origin: 'https://console.example.org', [CSRF_HEADER]: 'XMLHttpRequest' }, 200],
        ['allowed origin, no header', { origin: 'https://console.example.org' }, 403],
        ['foreign origin + header', { origin: 'https://evil.example', [CSRF_HEADER]: 'XMLHttpRequest' }, 403],
        ['no origin + header', { [CSRF_HEADER]: 'XMLHttpRequest' }, 403],
        ['no origin, no header', {}, 403],
    ];
    it.each(cases)('flag on, %s -> $2', async (_n, headers, status) => {
        const app = await build(true);
        const res = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: 'refreshToken=x', ...headers } });
        expect(res.statusCode).toBe(status);
        if (status === 200) expect(res.json().accessToken).toBeTruthy();
    });

    it('flag on: body-token (mobile) refresh without a cookie is untouched', async () => {
        const app = await build(true);
        const res = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { 'x-client': 'mobile' }, payload: { refreshToken: 'tok' } });
        expect(res.statusCode).toBe(200);
    });

    it('flag off: cookie refresh needs neither origin nor header (unchanged)', async () => {
        const app = await build(false);
        const res = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: 'refreshToken=x' } });
        expect(res.statusCode).toBe(200);
    });
});
