import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('../../services/notification.js', () => ({
    scheduleNotification: vi.fn(async () => undefined),
    cancelReminder: vi.fn(async () => undefined),
}));
vi.mock('../../services/wallet-clearing.js', async (orig) => ({
    ...(await orig<typeof import('../../services/wallet-clearing.js')>()),
    clearFundsForEntity: vi.fn(async () => undefined),
}));

import { publishEvent } from '../../services/events/publish.js';
import bookingsRoutes from './index.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

const booking = (status: string) => ({
    id: 'b1', tenantId: 't1', status, startTime: new Date(Date.now() - 3600_000), customerPhone: '+233241234567',
    service: { name: 'Cut' },
});

async function build(status: string) {
    const prisma: any = {
        booking: {
            findFirst: vi.fn(async () => booking(status)),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('queues', { notifications: null, reminders: null } as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role: 'OWNER' }; });
    await app.register(bookingsRoutes, { prefix: '/bookings' });
    return { app, prisma };
}

const patch = (app: any, status: string) =>
    app.inject({ method: 'PATCH', url: '/bookings/b1', payload: { status } });
const types = () => publish.mock.calls.map((c) => (c[1] as any).type);

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('PATCH /bookings/:id status events', () => {
    it('COMPLETED publishes booking.completed', async () => {
        const { app } = await build('CONFIRMED');
        expect((await patch(app, 'COMPLETED')).statusCode).toBe(200);
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1', type: 'booking.completed', payload: { v: 1, bookingId: 'b1' },
        });
    });

    it('CANCELLED publishes booking.cancelled with the dashboard as the reason', async () => {
        const { app } = await build('CONFIRMED');
        expect((await patch(app, 'CANCELLED')).statusCode).toBe(200);
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1', type: 'booking.cancelled', payload: { v: 1, bookingId: 'b1', reason: 'dashboard' },
        });
    });

    it('NO_SHOW publishes nothing (no such event)', async () => {
        const { app } = await build('CONFIRMED');
        await patch(app, 'NO_SHOW');
        expect(types()).toEqual([]);
    });

    it('re-saving the same status publishes nothing', async () => {
        const { app } = await build('COMPLETED');
        await patch(app, 'COMPLETED');
        expect(types()).toEqual([]);
    });

    it('a refused transition publishes nothing', async () => {
        const { app } = await build('CANCELLED');
        const res = await patch(app, 'COMPLETED');
        expect(res.statusCode).toBe(400);
        expect(types()).toEqual([]);
    });

    it('never fails the status change when the publish throws', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const { app } = await build('CONFIRMED');
        expect((await patch(app, 'COMPLETED')).statusCode).toBe(200);
    });
});
