import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/**
 * The console-proxy client IP through the REAL app (src/index.ts buildApp):
 * proves the hook runs before the global rate limiter, so per-IP buckets key on
 * the staff member's IP rather than the console's (Vercel's) egress address.
 */

vi.mock('../plugins/prisma.js', async (orig) => {
    const real = await orig<typeof import('../plugins/prisma.js')>();
    return { ...real, default: fp(async (app: any) => { app.decorate('prisma', {}); }, { name: 'prisma' }) };
});
vi.mock('../plugins/auth.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('authenticate', async (_request: any, reply: any) => reply.code(401).send({ message: 'Unauthorized' }));
        app.decorate('authenticateAdmin', async (_request: any, reply: any) => reply.code(401).send({ message: 'Unauthorized' }));
    }, { name: 'auth' }),
}));
vi.mock('../plugins/redis.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('redis', null);
        app.decorate('queues', { notifications: null, reminders: null });
    }, { name: 'redis' }),
}));

const SECRET = 'c'.repeat(64);
let app: FastifyInstance;

beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation-x';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-long-enough-for-validation';
    process.env.ADMIN_JWT_SECRET ??= 'test-admin-secret-long-enough-for-validation-x';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
    process.env.CONSOLE_PROXY_SECRET = SECRET;
    const { buildApp } = await import('../index.js');
    app = await buildApp();
    await app.ready();
});

afterAll(async () => {
    await app?.close();
    delete process.env.CONSOLE_PROXY_SECRET;
});

const fromConsole = (clientIp: string, secret = SECRET) =>
    app.inject({
        method: 'GET',
        url: '/auth/me',
        remoteAddress: '127.0.0.1', // nginx
        headers: { 'x-forwarded-for': '76.76.21.9', 'x-console-proxy-secret': secret, 'x-console-client-ip': clientIp },
    });

const remaining = (res: { headers: Record<string, unknown> }) => Number(res.headers['x-ratelimit-remaining']);

describe('console proxy client IP in the real app', () => {
    it('the global per-IP limit keys on the forwarded client IP', async () => {
        const a1 = remaining(await fromConsole('41.66.1.2'));
        const a2 = remaining(await fromConsole('41.66.1.2'));
        const b1 = remaining(await fromConsole('41.66.9.9'));
        expect(a1).toBeGreaterThan(0);
        expect(a2).toBe(a1 - 1);
        // A different staff member behind the same Vercel address starts fresh.
        expect(b1).toBe(a1);
    });

    it('a wrong secret falls back to the socket chain (the Vercel address bucket)', async () => {
        const v1 = remaining(await fromConsole('41.66.5.5', 'd'.repeat(64)));
        const v2 = remaining(await fromConsole('41.66.6.6', 'd'.repeat(64)));
        expect(v1).toBeGreaterThan(0);
        expect(v2).toBe(v1 - 1);
    });
});
