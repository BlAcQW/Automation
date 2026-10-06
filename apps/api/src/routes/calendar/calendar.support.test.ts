import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('googleapis', () => ({
    google: { auth: { OAuth2: class { generateAuthUrl() { return 'https://accounts.example/auth'; } } }, calendar: vi.fn() },
}));

async function build(user: Record<string, unknown>) {
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', {} as never);
    app.decorate('authenticate', async (request: any) => { request.user = user; });
    const calendarRoutes = (await import('./index.js')).default;
    await app.register(calendarRoutes as never, { prefix: '/calendar' });
    await app.ready();
    return app;
}

describe('GET /calendar/google/connect and support access', () => {
    it('refuses a support viewer: no signed OAuth state is issued', async () => {
        const app = await build({ userId: 'support:adm', tenantId: 't1', role: 'STAFF', support: { sessionId: 's', adminId: 'adm' } });
        const res = await app.inject({ method: 'GET', url: '/calendar/google/connect' });
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain('authUrl');
        await app.close();
    });
    it('a normal tenant user still gets the auth URL', async () => {
        const app = await build({ userId: 'u1', tenantId: 't1', role: 'OWNER' });
        const res = await app.inject({ method: 'GET', url: '/calendar/google/connect' });
        expect(res.statusCode).toBe(200);
        expect(res.json().authUrl).toBeTruthy();
        await app.close();
    });
});
