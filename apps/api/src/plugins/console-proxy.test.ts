import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CONSOLE_IP_HEADER,
    CONSOLE_SECRET_HEADER,
    consoleSecretMatches,
    registerConsoleProxyClientIp,
} from './console-proxy.js';

const SECRET = 'a'.repeat(64);
const NGINX = '127.0.0.1';
const VERCEL = '76.76.21.9';
const CLIENT = '41.66.1.2';

/** Behind nginx on loopback, like production: trustProxy 'loopback'. */
async function build(secret: string | undefined, max = 100) {
    const app = Fastify({ trustProxy: 'loopback' });
    registerConsoleProxyClientIp(app, secret);
    await app.register(rateLimit, { max, timeWindow: '1 minute', keyGenerator: (req) => `ip:${req.ip}` });
    app.post('/echo', async (req) => ({ ip: req.ip, headers: req.headers }));
    await app.ready();
    return app;
}

/** What nginx forwards for a request the console relayed from Vercel. */
function viaConsole(extra: Record<string, string> = {}) {
    return {
        method: 'POST' as const,
        url: '/echo',
        remoteAddress: NGINX,
        headers: { 'x-forwarded-for': VERCEL, ...extra },
        payload: {},
    };
}

describe('console proxy client IP', () => {
    it('with the right secret, request.ip is the forwarded client IP and both headers are removed', async () => {
        const app = await build(SECRET);
        const res = await app.inject(viaConsole({ [CONSOLE_SECRET_HEADER]: SECRET, [CONSOLE_IP_HEADER]: CLIENT }));
        const body = res.json();
        expect(body.ip).toBe(CLIENT);
        expect(body.headers).not.toHaveProperty(CONSOLE_SECRET_HEADER);
        expect(body.headers).not.toHaveProperty(CONSOLE_IP_HEADER);
    });

    it('accepts IPv6 client addresses', async () => {
        const app = await build(SECRET);
        const res = await app.inject(viaConsole({ [CONSOLE_SECRET_HEADER]: SECRET, [CONSOLE_IP_HEADER]: '2001:db8::7' }));
        expect(res.json().ip).toBe('2001:db8::7');
    });

    it.each([
        ['wrong secret', { [CONSOLE_SECRET_HEADER]: 'b'.repeat(64), [CONSOLE_IP_HEADER]: CLIENT }],
        ['secret of a different length', { [CONSOLE_SECRET_HEADER]: 'short', [CONSOLE_IP_HEADER]: CLIENT }],
        ['no secret', { [CONSOLE_IP_HEADER]: CLIENT }],
    ])('%s: request.ip is unchanged and the x-console-* headers are stripped', async (_name, headers) => {
        const app = await build(SECRET);
        const res = await app.inject(viaConsole({ ...headers, 'x-console-other': 'x' }));
        const body = res.json();
        expect(body.ip).toBe(VERCEL);
        expect(body.headers['x-forwarded-for']).toBe(VERCEL);
        for (const h of [CONSOLE_SECRET_HEADER, CONSOLE_IP_HEADER, 'x-console-other']) expect(body.headers).not.toHaveProperty(h);
    });

    it('does nothing (but still strips) when CONSOLE_PROXY_SECRET is not configured', async () => {
        for (const secret of [undefined, '']) {
            const app = await build(secret);
            const res = await app.inject(viaConsole({ [CONSOLE_SECRET_HEADER]: '', [CONSOLE_IP_HEADER]: CLIENT }));
            expect(res.json().ip).toBe(VERCEL);
            expect(res.json().headers).not.toHaveProperty(CONSOLE_IP_HEADER);
        }
    });

    it.each(['not-an-ip', '41.66.1.2, 10.0.0.1', '', '999.1.1.1'])('invalid client IP %j: request.ip is unchanged', async (ip) => {
        const app = await build(SECRET);
        const res = await app.inject(viaConsole({ [CONSOLE_SECRET_HEADER]: SECRET, [CONSOLE_IP_HEADER]: ip }));
        expect(res.json().ip).toBe(VERCEL);
        expect(res.json().headers).not.toHaveProperty(CONSOLE_SECRET_HEADER);
    });

    it('runs before the rate limiter: per-IP buckets key on the forwarded client IP', async () => {
        const app = await build(SECRET, 2);
        const asClient = (ip: string) => app.inject(viaConsole({ [CONSOLE_SECRET_HEADER]: SECRET, [CONSOLE_IP_HEADER]: ip }));
        expect((await asClient(CLIENT)).statusCode).toBe(200);
        expect((await asClient(CLIENT)).statusCode).toBe(200);
        expect((await asClient(CLIENT)).statusCode).toBe(429);
        // Same Vercel egress IP, a different staff member: their own bucket.
        expect((await asClient('41.66.9.9')).statusCode).toBe(200);
    });

    it('a spoofed x-console-client-ip without the secret cannot buy a fresh bucket', async () => {
        const app = await build(SECRET, 1);
        expect((await app.inject(viaConsole({ [CONSOLE_IP_HEADER]: '1.1.1.1' }))).statusCode).toBe(200);
        expect((await app.inject(viaConsole({ [CONSOLE_IP_HEADER]: '2.2.2.2' }))).statusCode).toBe(429);
    });

    it('is registered in src/index.ts before every plugin (CORS, CSRF, auth, rate limit)', () => {
        const src = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
        const body = src.slice(src.indexOf('async function buildApp'));
        const hook = body.indexOf('registerConsoleProxyClientIp(app');
        expect(hook).toBeGreaterThan(-1);
        expect(hook).toBeLessThan(body.indexOf('app.register('));
    });
});

describe('consoleSecretMatches', () => {
    it('is true only for an exact match of a configured secret', () => {
        expect(consoleSecretMatches(SECRET, SECRET)).toBe(true);
        expect(consoleSecretMatches(SECRET.slice(1), SECRET)).toBe(false);
        expect(consoleSecretMatches(undefined, SECRET)).toBe(false);
        expect(consoleSecretMatches(['x', SECRET], SECRET)).toBe(false);
        expect(consoleSecretMatches('', '')).toBe(false);
        expect(consoleSecretMatches(SECRET, undefined)).toBe(false);
    });
});
