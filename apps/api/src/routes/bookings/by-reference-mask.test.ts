/** GET /bookings/by-reference/:ref returns the whole booking, so it is masked like every other booking read. */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn(async () => ({ eventId: 'e' })) }));

import bookingsRoutes from './index.js';

async function build(user: Record<string, unknown>, maskCustomerContact = true) {
    const prisma: any = {
        tenant: { findUnique: vi.fn(async () => ({ maskCustomerContact })) },
        booking: {
            findFirst: vi.fn(async () => ({
                id: 'b1', tenantId: 't1', bookingReference: 'BK-1', customerPhone: '+233241234567', customerName: 'Ama', service: { name: 'Cut' },
            })),
        },
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('queues', { notifications: null, reminders: null } as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', ...user }; });
    await app.register(bookingsRoutes, { prefix: '/bookings' });
    return app;
}

const get = (app: any) => app.inject({ method: 'GET', url: '/bookings/by-reference/BK-1' });

describe('GET /bookings/by-reference/:ref masking', () => {
    it('masks the phone for STAFF when the tenant masks contacts', async () => {
        const res = await get(await build({ role: 'STAFF' }));
        expect(res.statusCode).toBe(200);
        expect(res.json().customerPhone).not.toBe('+233241234567');
    });

    it('always masks for a support viewer', async () => {
        const res = await get(await build({ role: 'OWNER', support: true }, false));
        expect(res.json().customerPhone).not.toBe('+233241234567');
    });

    it('shows the phone to the OWNER', async () => {
        const res = await get(await build({ role: 'OWNER' }));
        expect(res.json().customerPhone).toBe('+233241234567');
    });
});
