import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import rateLimitPlugin, { AUTH_SURFACE_PREFIX } from './rate-limit.js';

const SECRET = 'test-secret-test-secret-test-secret';

async function build(max = 3) {
    const app = Fastify({ trustProxy: true });
    await app.register(jwt, { secret: SECRET });
    await app.register(rateLimitPlugin, { max, timeWindow: '1 minute' });
    // Mirrors how real routes authenticate: in preHandler, AFTER the rate limiter.
    const authenticate = async (req: any) => { await req.jwtVerify(); };
    app.get('/orders', { preHandler: authenticate }, async (req: any) => ({ user: req.user?.userId }));
    app.post('/auth/login', async () => ({ ok: true }));
    app.get('/auth/me', async () => ({ ok: true }));
    app.get('/public/thing', async () => ({ ok: true }));
    app.get('/health/live', { config: { rateLimit: false } }, async () => ({ ok: true }));
    app.get('/limited', { config: { rateLimit: { max: 2, timeWindow: '1 minute', keyGenerator: (r: any) => `${r.user?.tenantId ?? r.ip}:custom` } } }, async () => ({ ok: true }));
    return app;
}

const token = (app: any, claims: Record<string, unknown>) => app.jwt.sign({ type: 'access', role: 'OWNER', ...claims });
const hit = (app: any, url: string, opts: { token?: string; ip?: string; method?: string } = {}) =>
    app.inject({
        method: (opts.method ?? 'GET') as any,
        url,
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
        remoteAddress: opts.ip ?? '10.0.0.1',
    });

describe('rate-limit identity', () => {
    it('gives each authenticated user their own budget behind one shared IP', async () => {
        const app = await build(3);
        const a = token(app, { userId: 'ua', tenantId: 't1' });
        const b = token(app, { userId: 'ub', tenantId: 't1' });
        for (let i = 0; i < 3; i++) expect((await hit(app, '/orders', { token: a })).statusCode).toBe(200);
        expect((await hit(app, '/orders', { token: a })).statusCode).toBe(429);
        // Same IP, different user: untouched.
        expect((await hit(app, '/orders', { token: b })).statusCode).toBe(200);
    });

    it('follows the user across IPs (the limit is not dodged by moving)', async () => {
        const app = await build(2);
        const a = token(app, { userId: 'ua', tenantId: 't1' });
        await hit(app, '/orders', { token: a, ip: '10.0.0.1' });
        await hit(app, '/orders', { token: a, ip: '10.0.0.2' });
        expect((await hit(app, '/orders', { token: a, ip: '10.0.0.3' })).statusCode).toBe(429);
    });

    it('an invalid or forged token falls back to the IP, so rotating fake users cannot dodge', async () => {
        const app = await build(2);
        const forged = (n: number) => app.jwt.sign({ userId: `fake${n}`, tenantId: `t${n}`, type: 'access', role: 'OWNER' }, { key: 'wrong-secret' } as any);
        const res = [];
        for (let i = 0; i < 3; i++) res.push((await hit(app, '/orders', { token: forged(i), ip: '10.9.9.9' })).statusCode);
        expect(res).toEqual([401, 401, 429]);
    });

    it('a refresh token (type != access) is not an identity', async () => {
        const app = await build(2);
        const refresh = (n: number) => app.jwt.sign({ type: 'refresh', userId: `u${n}`, tenantId: 't', role: 'OWNER' });
        const res = [];
        for (let i = 0; i < 3; i++) res.push((await hit(app, '/orders', { token: refresh(i), ip: '10.8.8.8' })).statusCode);
        expect(res[2]).toBe(429);
    });

    it('unauthenticated routes stay per-IP, with the real client IP via trustProxy', async () => {
        const app = await build(2);
        const viaProxy = (xff: string) =>
            app.inject({ method: 'GET', url: '/public/thing', headers: { 'x-forwarded-for': xff }, remoteAddress: '127.0.0.1' });
        expect((await viaProxy('203.0.113.1')).statusCode).toBe(200);
        expect((await viaProxy('203.0.113.1')).statusCode).toBe(200);
        expect((await viaProxy('203.0.113.1')).statusCode).toBe(429);
        // A different client behind the same proxy is not locked out.
        expect((await viaProxy('203.0.113.2')).statusCode).toBe(200);
    });

    it('the /auth surface is always keyed by IP, even with a valid token', async () => {
        const app = await build(2);
        expect(AUTH_SURFACE_PREFIX).toBe('/auth');
        const mk = (n: number) => token(app, { userId: `u${n}`, tenantId: 't' });
        const res = [];
        // Three distinct valid users from one IP: still one shared bucket.
        for (let i = 0; i < 3; i++) res.push((await hit(app, '/auth/login', { token: mk(i), method: 'POST', ip: '10.7.7.7' })).statusCode);
        expect(res).toEqual([200, 200, 429]);
        const res2 = [];
        for (let i = 0; i < 3; i++) res2.push((await hit(app, '/auth/me', { token: mk(i), ip: '10.7.7.8' })).statusCode);
        expect(res2).toEqual([200, 200, 429]);
    });

    it('does not mistake a path that merely starts with "auth" for the auth surface', async () => {
        const app = await build(2);
        app.get('/authors', async () => ({ ok: true }));
        const a = token(app, { userId: 'ua', tenantId: 't' });
        const b = token(app, { userId: 'ub', tenantId: 't' });
        for (let i = 0; i < 2; i++) await hit(app, '/authors', { token: a, ip: '10.6.6.6' });
        expect((await hit(app, '/authors', { token: b, ip: '10.6.6.6' })).statusCode).toBe(200);
    });

    it('routes with rateLimit:false are never limited', async () => {
        const app = await build(1);
        for (let i = 0; i < 5; i++) expect((await hit(app, '/health/live')).statusCode).toBe(200);
    });

    it('per-route keyGenerators that read req.user now see the verified tenant', async () => {
        const app = await build(100);
        const a = token(app, { userId: 'ua', tenantId: 't1' });
        const b = token(app, { userId: 'ub', tenantId: 't1' });
        await hit(app, '/limited', { token: a, ip: '10.5.5.1' });
        await hit(app, '/limited', { token: b, ip: '10.5.5.2' });
        // Same tenant from two IPs shares one bucket of 2.
        expect((await hit(app, '/limited', { token: a, ip: '10.5.5.3' })).statusCode).toBe(429);
    });

    it('a request without any credentials is limited per IP', async () => {
        const app = await build(2);
        const r = [];
        for (let i = 0; i < 3; i++) r.push((await hit(app, '/orders', { ip: '10.4.4.4' })).statusCode);
        expect(r).toEqual([401, 401, 429]);
    });
});
