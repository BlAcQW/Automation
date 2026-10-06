import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import authRoutes from './index.js';

const tenant = {
    id: 't1', name: 'Glow Salon', businessType: 'SERVICE', timezone: 'Africa/Accra',
    whatsappPhoneNumberId: 'pn1', outOfWindowMessagesEnabled: false, depositRequired: true,
    defaultDepositAmount: 50, bookingCapacity: 2, maskCustomerContact: false,
    paymentCurrency: 'GHS', deletionRequestedAt: null,
};

async function build(user: Record<string, unknown>) {
    const prisma = {
        user: { findFirst: vi.fn(async () => null) },
        tenant: { findFirst: vi.fn(async () => tenant), findUnique: vi.fn(async () => tenant) },
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma as any);
    app.decorate('authenticate', async (req: any) => { req.user = user; });
    app.decorate('jwt', { sign: () => 'x' } as any);
    await app.register(authRoutes, { prefix: '/auth' });
    return { app, prisma };
}

describe('GET /auth/me with a support token', () => {
    it('returns a read-only support identity and the tenant, without a real user row', async () => {
        const { app, prisma } = await build({
            userId: 'support:adm1', tenantId: 't1', role: 'STAFF',
            support: { sessionId: 's1', adminId: 'adm1' },
        });
        const res = await app.inject({ method: 'GET', url: '/auth/me' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.user).toMatchObject({ role: 'STAFF', support: true, readOnly: true });
        expect(body.user.email).toBeNull();
        expect(body.tenant).toMatchObject({ id: 't1', name: 'Glow Salon', currency: 'GHS', whatsappConnected: true });
        // Support viewers always see masked contacts, whatever the tenant setting.
        expect(body.tenant.maskCustomerContact).toBe(true);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('still 404s for a normal token whose user no longer exists', async () => {
        const { app } = await build({ userId: 'u-gone', tenantId: 't1', role: 'OWNER' });
        const res = await app.inject({ method: 'GET', url: '/auth/me' });
        expect(res.statusCode).toBe(404);
    });
});
