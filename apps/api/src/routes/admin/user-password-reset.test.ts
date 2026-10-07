import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

// Config is read once at import: give it a Bookly front end and one console.
vi.hoisted(() => {
    process.env.FRONTEND_URL = 'https://app.bookly.test';
    process.env.CORS_ORIGINS = 'https://turbo-gh.vercel.app';
});

const mail = vi.hoisted(() => ({
    creds: { user: 'noreply@bookly.test', appPassword: 'x', source: 'platform' } as any,
    sendEmail: vi.fn(),
}));
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => mail.creds,
    sendEmail: mail.sendEmail,
}));

import userPasswordResetRoutes from './user-password-reset.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';
import { config } from '../../config/index.js';
import { parseResetToken, verifyResetToken } from '../../services/password-reset.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });
beforeEach(() => {
    vi.clearAllMocks();
    mail.creds = { user: 'noreply@bookly.test', appPassword: 'x', source: 'platform' };
    mail.sendEmail.mockResolvedValue({ ok: true, messageId: 'm1' });
});

const HASH = bcrypt.hashSync('Secret123', 4);
const userRow = (over: Record<string, unknown> = {}) => ({
    id: 'u1', tenantId: 't1', name: 'Kofi Driver', email: 'kofi@turbo.example', passwordHash: HASH, isActive: true,
    tenant: { isActive: true, vertical: 'RIDES' },
    ...over,
});

async function build(row: Record<string, unknown> | null = userRow()) {
    prisma = makePrisma();
    prisma.user.findFirst.mockImplementation(async ({ where }: any) =>
        row && where.id === row.id && where.tenantId === row.tenantId ? row : null);
    app = await buildAdminTestApp(async (s) => { await s.register(userPasswordResetRoutes); }, { prisma });
}

const EMAIL_URL = '/admin/tenants/t1/users/u1/password-reset/email';
const LINK_URL = '/admin/tenants/t1/users/u1/password-reset/link';
const post = (headers: any, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers, payload: payload as any });

describe('POST /admin/tenants/:id/users/:userId/password-reset/email', () => {
    it.each(['OWNER', 'SUPPORT'])('%s sends the standard reset email with the Bookly link, audited', async (role) => {
        await build();
        const { headers, row } = signedInAs(app, prisma, role);
        const res = await post(headers, EMAIL_URL);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, email: 'kofi@turbo.example' });

        expect(mail.sendEmail).toHaveBeenCalledTimes(1);
        const sent = mail.sendEmail.mock.calls[0][0];
        expect(sent.to).toBe('kofi@turbo.example');
        expect(sent.subject).toMatch(/reset your bookly password/i);
        const link = new URL(sent.text.match(/https:\/\/\S+/)[0]);
        expect(link.origin + link.pathname).toBe('https://app.bookly.test/reset-password');
        expect(verifyResetToken(link.searchParams.get('token')!, { id: 'u1', passwordHash: HASH }, config.jwtSecret)).toBe(true);

        expect(prisma.audits).toEqual([expect.objectContaining({
            action: 'auth.password_reset.admin_sent', actorType: 'ADMIN', actorId: row.id,
            tenantId: 't1', targetType: 'User', targetId: 'u1',
        })]);
        expect(JSON.stringify(prisma.audits)).not.toContain(link.searchParams.get('token'));
    });

    it('the user lookup is scoped to the organisation in the URL', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        await post(headers, EMAIL_URL);
        expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'u1', tenantId: 't1' });
    });

    it('404 when the user is not in that organisation', async () => {
        await build(userRow({ tenantId: 'other' }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, EMAIL_URL);
        expect(res.statusCode).toBe(404);
        expect(mail.sendEmail).not.toHaveBeenCalled();
        expect(prisma.audits).toEqual([]);
    });

    it('refuses an inactive user and an inactive organisation with 409', async () => {
        await build(userRow({ isActive: false }));
        let { headers } = signedInAs(app, prisma, 'OWNER');
        let res = await post(headers, EMAIL_URL);
        expect(res.statusCode).toBe(409);
        expect(res.json().message).toMatch(/user is deactivated/i);
        await app.close();

        await build(userRow({ tenant: { isActive: false, vertical: 'RIDES' } }));
        ({ headers } = signedInAs(app, prisma, 'OWNER'));
        res = await post(headers, EMAIL_URL);
        expect(res.statusCode).toBe(409);
        expect(res.json().message).toMatch(/organisation is deactivated/i);
        expect(mail.sendEmail).not.toHaveBeenCalled();
    });

    it('503 and no audit when the email cannot be sent', async () => {
        await build();
        mail.sendEmail.mockResolvedValue({ ok: false, error: 'smtp down' });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, EMAIL_URL);
        expect(res.statusCode).toBe(503);
        expect(res.json().code).toBe('RESET_EMAIL_NOT_SENT');
        expect(prisma.audits).toEqual([]);
    });

    it('503 when no platform sender is configured', async () => {
        await build();
        mail.creds = null;
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, EMAIL_URL)).statusCode).toBe(503);
    });

    it.each(['FINANCE', 'READONLY'])('%s is refused', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        expect((await post(headers, EMAIL_URL)).statusCode).toBe(403);
        expect(mail.sendEmail).not.toHaveBeenCalled();
    });
});

describe('POST /admin/tenants/:id/users/:userId/password-reset/link', () => {
    it('OWNER gets a one-hour Bookly link that really resets the password; nothing is emailed', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        const before = Date.now();
        const res = await post(headers, LINK_URL);
        expect(res.statusCode).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.json();
        expect(Object.keys(body).sort()).toEqual(['expiresAt', 'link']);
        const link = new URL(body.link);
        expect(link.origin + link.pathname).toBe('https://app.bookly.test/reset-password');
        const token = link.searchParams.get('token')!;
        expect(verifyResetToken(token, { id: 'u1', passwordHash: HASH }, config.jwtSecret)).toBe(true);
        const exp = new Date(body.expiresAt).getTime();
        expect(exp).toBe(parseResetToken(token)!.exp * 1000);
        expect(exp - before).toBeGreaterThan(59 * 60 * 1000);
        expect(exp - before).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
        expect(mail.sendEmail).not.toHaveBeenCalled();

        expect(prisma.audits).toEqual([expect.objectContaining({
            action: 'auth.password_reset.admin_link_created', actorType: 'ADMIN', actorId: row.id,
            tenantId: 't1', targetType: 'User', targetId: 'u1',
            metadata: { resetOrigin: 'https://app.bookly.test' },
        })]);
        const audited = JSON.stringify(prisma.audits);
        expect(audited).not.toContain(token);
        expect(audited).not.toContain('reset-password?');
    });

    it('uses an allowed console reset page when asked', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, LINK_URL, { resetUrl: 'https://turbo-gh.vercel.app/reset-password' });
        expect(res.statusCode).toBe(200);
        const link = new URL(res.json().link);
        expect(link.origin + link.pathname).toBe('https://turbo-gh.vercel.app/reset-password');
        expect(prisma.audits[0].metadata).toEqual({ resetOrigin: 'https://turbo-gh.vercel.app' });
    });

    it.each([
        ['a foreign origin', 'https://evil.example.com/reset-password'],
        ['http', 'http://turbo-gh.vercel.app/reset-password'],
        ['javascript:', 'javascript:alert(1)'],
        ['a lookalike host', 'https://turbo-gh.vercel.app.evil.com/reset-password'],
    ])('refuses %s with 400 (the admin sees the problem) and mints nothing', async (_l, resetUrl) => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, LINK_URL, { resetUrl });
        expect(res.statusCode).toBe(400);
        expect(prisma.audits).toEqual([]);
    });

    it('rejects unknown body fields', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, LINK_URL, { password: 'x' })).statusCode).toBe(400);
    });

    it('404 / 409 like the email route', async () => {
        await build(null);
        let { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, LINK_URL)).statusCode).toBe(404);
        await app.close();
        await build(userRow({ isActive: false }));
        ({ headers } = signedInAs(app, prisma, 'OWNER'));
        expect((await post(headers, LINK_URL)).statusCode).toBe(409);
    });

    it.each(['SUPPORT', 'FINANCE', 'READONLY'])('%s is refused (OWNER only)', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        expect((await post(headers, LINK_URL)).statusCode).toBe(403);
        expect(prisma.audits).toEqual([]);
    });
});

describe('GET /admin/password-reset/link-options', () => {
    it('OWNER sees Bookly first, then the allowed console', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await app.inject({ method: 'GET', url: '/admin/password-reset/link-options', headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual([
            { label: 'Bookly', origin: 'https://app.bookly.test', resetUrl: 'https://app.bookly.test/reset-password', isDefault: true },
            { label: 'turbo-gh.vercel.app', origin: 'https://turbo-gh.vercel.app', resetUrl: 'https://turbo-gh.vercel.app/reset-password', isDefault: false },
        ]);
    });

    it('SUPPORT is refused', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        expect((await app.inject({ method: 'GET', url: '/admin/password-reset/link-options', headers })).statusCode).toBe(403);
    });
});

describe('organisation tokens cannot reach these routes', () => {
    it.each(['support', 'access'])('a tenant %s token is 401 on every reset route', async (type) => {
        await build();
        const token = (app as any).jwt.sign({
            userId: 'u1', tenantId: 't1', role: 'OWNER', type,
            ...(type === 'support' && { support: { sessionId: 's1', adminId: 'admin-owner' } }),
        }, { expiresIn: '5m' });
        const headers = { authorization: `Bearer ${token}` };
        expect((await post(headers, EMAIL_URL)).statusCode).toBe(401);
        expect((await post(headers, LINK_URL)).statusCode).toBe(401);
        expect((await app.inject({ method: 'GET', url: '/admin/password-reset/link-options', headers })).statusCode).toBe(401);
        expect(mail.sendEmail).not.toHaveBeenCalled();
    });
});
