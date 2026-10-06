import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import csrfPlugin, { crossSiteClearOptions, crossSiteCookieOptions, CSRF_HEADER } from './csrf.js';

const ALLOWED = 'https://console.example.org';
const COOKIE = 'refreshToken=abc123';

async function build(opts: { enabled: boolean; ignoreTrailingSlash?: boolean }) {
    const app = Fastify({ ignoreTrailingSlash: opts.ignoreTrailingSlash });
    await app.register(cookie);
    await app.register(csrfPlugin, { enabled: opts.enabled, origins: [ALLOWED, 'https://app.example.com'] });
    app.post('/auth/refresh', async () => ({ ok: true }));
    app.post('/auth/logout', async () => ({ ok: true }));
    app.post('/admin/auth/logout', async () => ({ ok: true }));
    app.post('/auth/login', async () => ({ ok: true }));
    app.get('/auth/me', async () => ({ ok: true }));
    await app.ready();
    return app;
}

const post = (app: Awaited<ReturnType<typeof build>>, url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers });

describe('csrf plugin (cross-site auth ON)', () => {
    it.each(['/auth/refresh', '/auth/logout', '/admin/auth/logout'])('%s: allowed origin + header passes', async (url) => {
        const app = await build({ enabled: true });
        const cookieName = url.startsWith('/admin') ? 'adminRefreshToken=x' : COOKIE;
        const res = await post(app, url, { cookie: cookieName, origin: ALLOWED, [CSRF_HEADER]: 'XMLHttpRequest' });
        expect(res.statusCode).toBe(200);
    });

    it('rejects an allowed origin without the custom header', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh', { cookie: COOKIE, origin: ALLOWED });
        expect(res.statusCode).toBe(403);
    });

    it('rejects an empty custom header', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh', { cookie: COOKIE, origin: ALLOWED, [CSRF_HEADER]: '' });
        expect(res.statusCode).toBe(403);
    });

    it('rejects a foreign origin even with the header', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh', { cookie: COOKIE, origin: 'https://evil.example', [CSRF_HEADER]: 'XMLHttpRequest' });
        expect(res.statusCode).toBe(403);
    });

    it('requires an exact origin match (no suffix, scheme or port tricks)', async () => {
        const app = await build({ enabled: true });
        for (const origin of [
            ALLOWED + '.evil.com', 'http://console.example.org', ALLOWED + ':8443', ALLOWED + '/', 'null',
            'https://CONSOLE.example.org',
        ]) {
            const res = await post(app, '/auth/refresh', { cookie: COOKIE, origin, [CSRF_HEADER]: 'x' });
            expect(res.statusCode, origin).toBe(403);
        }
    });

    it('rejects a cookie request with no Origin header', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh', { cookie: COOKIE, [CSRF_HEADER]: 'XMLHttpRequest' });
        expect(res.statusCode).toBe(403);
    });

    it('does not guard requests that carry no refresh cookie (mobile body-token clients)', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh');
        expect(res.statusCode).toBe(200);
    });

    it('does not guard unrelated routes or safe methods', async () => {
        const app = await build({ enabled: true });
        expect((await post(app, '/auth/login', { cookie: COOKIE })).statusCode).toBe(200);
        expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: COOKIE } })).statusCode).toBe(200);
    });

    it('matches the path ignoring query string and trailing slash tricks', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh?x=1', { cookie: COOKIE });
        expect(res.statusCode).toBe(403);
    });

    it.each([
        '/auth/%72efresh', '/auth/refresh;x', '/auth/refresh;x=1?y=2', '/auth/refresh/', '/auth//refresh', '/auth/%52efresh',
        '/%61uth/refresh', '/auth/refresh%3Bx', '/auth/./refresh', '/admin/auth/%6Cogout',
    ])('guards the path variant %s that still reaches the handler', async (url) => {
        const app = await build({ enabled: true, ignoreTrailingSlash: true });
        const cookieName = url.startsWith('/admin') ? 'adminRefreshToken=x' : COOKIE;
        const res = await post(app, url, { cookie: cookieName, origin: 'https://evil.example', [CSRF_HEADER]: 'x' });
        // Either the router refuses the variant (404) or the guard blocks it; never the handler.
        expect(res.statusCode, `${url} reached the handler unguarded`).not.toBe(200);
        expect([403, 404]).toContain(res.statusCode);
    });

    it('guards by the resolved route, as production registers it (prefix + child path)', async () => {
        const app = Fastify();
        await app.register(cookie);
        await app.register(csrfPlugin, { enabled: true, origins: [ALLOWED] });
        await app.register(async (api) => { api.post('/refresh', async () => ({ ok: true })); }, { prefix: '/auth' });
        await app.ready();
        const res = await post(app, '/auth/%72efresh', { cookie: COOKIE, origin: 'https://evil.example' });
        expect(res.statusCode).toBe(403);
    });

    it('returns a plain 403 that does not leak config', async () => {
        const app = await build({ enabled: true });
        const res = await post(app, '/auth/refresh', { cookie: COOKIE, origin: 'https://evil.example' });
        expect(res.body).not.toContain('console.example.org');
    });
});

describe('csrf plugin (flag OFF = today)', () => {
    it('never blocks anything', async () => {
        const app = await build({ enabled: false });
        expect((await post(app, '/auth/refresh', { cookie: COOKIE })).statusCode).toBe(200);
        expect((await post(app, '/auth/logout', { cookie: COOKIE, origin: 'https://evil.example' })).statusCode).toBe(200);
    });
});

describe('crossSiteCookieOptions', () => {
    const base = { path: '/', maxAge: 604800 };
    it('flag off: exactly the legacy attributes (lax, secure only in production)', () => {
        expect(crossSiteCookieOptions(base, { crossSite: false, nodeEnv: 'development' })).toEqual({
            httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 604800,
        });
        expect(crossSiteCookieOptions(base, { crossSite: false, nodeEnv: 'production' })).toEqual({
            httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 604800,
        });
    });
    it('flag on: SameSite=None; Secure; httpOnly', () => {
        expect(crossSiteCookieOptions(base, { crossSite: true, nodeEnv: 'production' })).toEqual({
            httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: 604800,
        });
    });
    it('flag on and secure even in dev override', () => {
        expect(crossSiteCookieOptions(base, { crossSite: true, nodeEnv: 'development' }).secure).toBe(true);
    });
});

describe('Set-Cookie header on the wire', () => {
    it('serialises SameSite=None; Secure; HttpOnly when on, SameSite=Lax when off', async () => {
        for (const [crossSite, expected] of [[true, /SameSite=None/i], [false, /SameSite=Lax/i]] as const) {
            const app = Fastify();
            await app.register(cookie);
            app.get('/c', async (_req, reply) => {
                reply.setCookie('refreshToken', 'v', crossSiteCookieOptions({ path: '/', maxAge: 60 }, { crossSite, nodeEnv: 'production' }));
                return {};
            });
            const res = await app.inject({ method: 'GET', url: '/c' });
            const header = String(res.headers['set-cookie']);
            expect(header).toMatch(expected);
            expect(header).toMatch(/HttpOnly/i);
            expect(header).toMatch(/Secure/i);
        }
    });
});

describe('crossSiteClearOptions', () => {
    it('flag off: legacy { path } only', () => {
        expect(crossSiteClearOptions('/', { crossSite: false })).toEqual({ path: '/' });
    });
    it('flag on: carries SameSite=None; Secure so cross-site deletion is honoured', () => {
        expect(crossSiteClearOptions('/', { crossSite: true })).toEqual({
            httpOnly: true, secure: true, sameSite: 'none', path: '/',
        });
    });
});
