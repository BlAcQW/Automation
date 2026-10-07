import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fp from 'fastify-plugin';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

// Same stubbing strategy as tenant-isolation.test.ts: swap the infrastructure
// plugins before buildApp() so the real auth routes run over a fake database.
vi.mock('../../plugins/prisma.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('prisma', (globalThis as any).__prismaStub);
    }, { name: 'prisma' }),
}));

vi.mock('../../plugins/auth.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('authenticate', async () => undefined);
        app.decorate('authenticateAdmin', async () => undefined);
    }, { name: 'auth' }),
}));

vi.mock('../../plugins/redis.js', () => ({
    default: fp(async (app: any) => {
        app.decorate('redis', null);
        app.decorate('queues', { notifications: null, reminders: null });
    }, { name: 'redis' }),
}));

// No SMTP in tests. Capture what would have been sent.
const sent: Array<{ to: string; text: string; html: string }> = [];
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => ({ user: 'noreply@bookly.test', appPassword: 'x', source: 'platform' }),
    sendEmail: vi.fn(async (args: any) => {
        sent.push({ to: args.to, text: args.text, html: args.html });
        return { ok: true, messageId: 'stub' };
    }),
}));

/** One user, whose password hash we can move to prove single-use. */
const dbUser = {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'ama@example.com',
    name: 'Ama Mensah',
    passwordHash: '',
    isActive: true,
};

const prismaStub: any = {
    user: {
        findFirst: vi.fn(async (args: any) => {
            const where = args.where ?? {};
            if (where.email && where.email !== dbUser.email) return null;
            if (where.id && where.id !== dbUser.id) return null;
            return { ...dbUser };
        }),
        update: vi.fn(async (args: any) => {
            dbUser.passwordHash = args.data.passwordHash;
            return { ...dbUser };
        }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => [{ '?column?': 1 }],
    $queryRawUnsafe: async () => [{ '?column?': 1 }],
};
(globalThis as any).__prismaStub = prismaStub;

let app: FastifyInstance;

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-validation';
    process.env.FRONTEND_URL = 'https://app.bookly.test';
    process.env.CORS_ORIGINS = 'https://turbo-gh.vercel.app';
    dbUser.passwordHash = await bcrypt.hash('OldPassword1', 4);
    const { buildApp } = await import('../../index.js');
    app = await buildApp();
    await app.ready();
});

afterAll(async () => {
    await app.close();
});

beforeEach(() => {
    sent.length = 0;
});

function linkFrom(text: string): string {
    const m = text.match(/https:\/\/app\.bookly\.test\/reset-password\?token=\S+/);
    if (!m) throw new Error('no reset link in email');
    return m[0];
}

function tokenFrom(link: string): string {
    return decodeURIComponent(new URL(link).searchParams.get('token')!);
}

describe('POST /auth/forgot-password', () => {
    it('answers the same for an unknown address and sends nothing', async () => {
        const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'nobody@example.com' } });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        expect(sent).toHaveLength(0);
    });

    it('emails a reset link to a known address', async () => {
        const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: dbUser.email } });
        expect(res.statusCode).toBe(200);
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe(dbUser.email);
        expect(linkFrom(sent[0].text)).toContain('/reset-password?token=');
    });

    it('rejects a malformed email with 400, not 500', async () => {
        const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'not-an-email' } });
        expect(res.statusCode).toBe(400);
    });
});

describe('POST /auth/forgot-password with resetUrl (console reset pages)', () => {
    // A fresh client address per request so the 5-per-15-minutes limit does not trip.
    let ip = 0;
    const nextIp = () => `10.9.0.${++ip}`;
    const ask = (resetUrl: unknown) =>
        app.inject({ method: 'POST', url: '/auth/forgot-password', remoteAddress: nextIp(), payload: { email: dbUser.email, resetUrl } as any });
    const onlyLink = () => {
        expect(sent).toHaveLength(1);
        const links = sent[0].text.match(/https?:\/\/\S+/g) ?? [];
        expect(links).toHaveLength(1);
        return new URL(links[0]!);
    };

    it('uses the caller\'s reset page when its origin is an allowed one', async () => {
        const res = await ask('https://turbo-gh.vercel.app/reset-password');
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        const link = onlyLink();
        expect(link.origin).toBe('https://turbo-gh.vercel.app');
        expect(link.pathname).toBe('/reset-password');
        expect(link.searchParams.get('token')).toMatch(/^[\w-]+\.[\w-]+$/);
    });

    it('the token in a console link resets the password like a Bookly one', async () => {
        await ask('https://turbo-gh.vercel.app/reset-password');
        const token = onlyLink().searchParams.get('token')!;
        const ok = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'ConsolePass9' } });
        expect(ok.statusCode).toBe(200);
    });

    it.each([
        ['a foreign origin', 'https://evil.example.com/reset-password'],
        ['http', 'http://turbo-gh.vercel.app/reset-password'],
        ['javascript:', 'javascript:alert(document.cookie)'],
        ['a lookalike host', 'https://turbo-gh.vercel.app.evil.com/reset-password'],
        ['a non-string', 42],
    ])('ignores %s and sends the default Bookly link, same answer', async (_label, resetUrl) => {
        const res = await ask(resetUrl);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        const link = onlyLink();
        expect(link.origin).toBe('https://app.bookly.test');
        expect(link.pathname).toBe('/reset-password');
        expect(sent[0].html).not.toContain('evil');
    });

    it('an unknown email with a resetUrl still answers the same and sends nothing', async () => {
        const res = await app.inject({ method: 'POST', url: '/auth/forgot-password', remoteAddress: nextIp(), payload: { email: 'nobody@example.com', resetUrl: 'https://turbo-gh.vercel.app/reset-password' } });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        expect(sent).toHaveLength(0);
    });
});

describe('POST /auth/reset-password', () => {
    it('sets the new password from a fresh link, then refuses the same link', async () => {
        await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: dbUser.email } });
        const token = tokenFrom(linkFrom(sent[0].text));

        const ok = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'NewPassword2' } });
        expect(ok.statusCode).toBe(200);
        expect(await bcrypt.compare('NewPassword2', dbUser.passwordHash)).toBe(true);

        // The hash changed, so the HMAC no longer matches: single use.
        const again = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'Another3rd' } });
        expect(again.statusCode).toBe(400);
        expect(again.json().message).toMatch(/invalid or has expired/i);
    });

    it('refuses garbage and short passwords', async () => {
        const bad = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: 'x'.repeat(30), password: 'LongEnough1' } });
        expect(bad.statusCode).toBe(400);
        const short = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token: 'x'.repeat(30), password: 'short' } });
        expect(short.statusCode).toBe(400);
    });
});
