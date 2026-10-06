import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import errorHandler from '../../plugins/error-handler.js';
import authRoutes from './index.js';

vi.mock('../../services/audit.js', () => ({ audit: vi.fn(async () => undefined) }));
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => null,
    sendEmail: vi.fn(async () => ({ ok: true })),
}));

async function build() {
    const created: Record<string, any> = {};
    const tx = {
        tenant: { create: vi.fn(async ({ data }: any) => { created.tenant = data; return { id: 't1', name: data.name, businessType: 'SERVICE', timezone: data.timezone, ...data }; }) },
        // claimOwnerEmail runs inside the transaction: advisory lock + re-check.
        $executeRaw: vi.fn(async () => 1),
        user: {
            create: vi.fn(async ({ data }: any) => ({ id: 'u1', ...data })),
            findFirst: vi.fn(async () => null),
        },
        workingHours: { createMany: vi.fn(async () => ({ count: 5 })) },
        wallet: { create: vi.fn(async ({ data }: any) => { created.wallet = data; return { id: 'w1', ...data }; }) },
    };
    const app = Fastify();
    app.decorate('jwt', { sign: () => 'signed.jwt.token', verify: () => ({}) } as any);
    app.decorate('authenticate', async () => undefined);
    app.decorate('prisma', { user: { findFirst: async () => null }, $transaction: async (fn: any) => fn(tx) } as any);
    await app.register(cookie);
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
    return { app, created, tx };
}

const register = (app: any) => app.inject({
    method: 'POST', url: '/auth/register',
    payload: { email: 'new@salon.co', password: 'password123', name: 'Ama', businessName: 'Glow', acceptTerms: true },
});

describe('self-registration sets ONE currency for the tenant and its wallet', () => {
    it('sets paymentCurrency explicitly (the schema default is NGN) to GHS', async () => {
        const { app, created } = await build();
        expect((await register(app)).statusCode).toBe(200);
        expect(created.tenant.paymentCurrency).toBe('GHS');
    });

    it('creates the wallet in the same transaction, in the same currency as the tenant', async () => {
        const { app, created, tx } = await build();
        await register(app);
        expect(tx.wallet.create).toHaveBeenCalledTimes(1);
        expect(created.wallet).toEqual({ tenantId: 't1', currency: created.tenant.paymentCurrency });
    });
});
