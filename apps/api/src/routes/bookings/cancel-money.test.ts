import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

const cancelMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/booking-cancel.js', async (orig) => ({
    ...(await orig<typeof import('../../services/booking-cancel.js')>()),
    cancelBooking: cancelMock,
}));
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn(async () => ({ eventId: 'e' })) }));
vi.mock('../../services/notification.js', () => ({
    scheduleNotification: vi.fn(async () => undefined),
    cancelReminder: vi.fn(async () => undefined),
}));
vi.mock('../../services/wallet-clearing.js', async (orig) => ({
    ...(await orig<typeof import('../../services/wallet-clearing.js')>()),
    clearFundsForEntity: vi.fn(async () => undefined),
}));

import bookingsRoutes from './index.js';

type Row = Record<string, unknown>;
const row = (over: Row = {}): Row => ({
    id: 'b1', tenantId: 't1', status: 'CONFIRMED', paymentStatus: 'UNPAID', collectionRoute: null, depositState: null,
    startTime: new Date(Date.now() + 3600_000), customerPhone: '+233241234567', service: { name: 'Cut' }, ...over,
});

async function build(role: 'OWNER' | 'STAFF', booking: Row) {
    const prisma: any = {
        booking: {
            findFirst: vi.fn(async () => booking),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
    };
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('queues', { notifications: null, reminders: null } as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role }; });
    await app.register(bookingsRoutes, { prefix: '/bookings' });
    return { app, prisma };
}

const cancel = (app: any) => app.inject({ method: 'POST', url: '/bookings/b1/cancel' });
const patch = (app: any, payload: Row) => app.inject({ method: 'PATCH', url: '/bookings/b1', payload });

const paidPlatform = () => row({ paymentStatus: 'PAID', collectionRoute: 'PLATFORM' });

beforeEach(() => {
    cancelMock.mockReset();
    cancelMock.mockResolvedValue({ ok: true, booking: { id: 'b1', bookingReference: 'BK-1', serviceName: 'Cut' } });
});

describe('POST /bookings/:id/cancel and money', () => {
    it('STAFF cannot cancel a booking whose deposit would be refunded', async () => {
        const { app } = await build('STAFF', paidPlatform());
        const res = await cancel(app);
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toMatch(/owner/i);
        expect(cancelMock).not.toHaveBeenCalled();
    });

    it('the OWNER can, and the salon is the canceller (so the customer is refunded)', async () => {
        const { app } = await build('OWNER', paidPlatform());
        expect((await cancel(app)).statusCode).toBe(200);
        expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ cancelledBy: 'BUSINESS', bookingId: 'b1', tenantId: 't1' }));
    });

    it('STAFF can still cancel when no money moves: unpaid', async () => {
        const { app } = await build('STAFF', row());
        expect((await cancel(app)).statusCode).toBe(200);
        expect(cancelMock).toHaveBeenCalled();
    });

    it('STAFF can still cancel when no money moves: paid into the tenant own gateway (Bookly never held it)', async () => {
        const { app } = await build('STAFF', row({ paymentStatus: 'PAID', collectionRoute: 'OWN_GATEWAY' }));
        expect((await cancel(app)).statusCode).toBe(200);
    });

    it('an unknown or missing route on a PAID booking is treated as money-moving (fail closed)', async () => {
        const { app } = await build('STAFF', row({ paymentStatus: 'PAID', collectionRoute: null }));
        expect((await cancel(app)).statusCode).toBe(403);
    });

    it('a booking from another tenant is still a 404 before any role talk', async () => {
        const { app, prisma } = await build('STAFF', paidPlatform());
        prisma.booking.findFirst = vi.fn(async () => null);
        expect((await cancel(app)).statusCode).toBe(404);
    });
});

describe('PATCH /bookings/:id cannot be used to dodge the same rule', () => {
    it('STAFF cancelling a paid platform booking through PATCH is refused too', async () => {
        const { app, prisma } = await build('STAFF', paidPlatform());
        const res = await patch(app, { status: 'CANCELLED' });
        expect(res.statusCode).toBe(403);
        expect(prisma.booking.updateMany).not.toHaveBeenCalled();
        expect(cancelMock).not.toHaveBeenCalled();
    });

    it('OWNER cancelling a CONFIRMED booking through PATCH goes through the shared cancel (refund path), not a bare status flip', async () => {
        const { app, prisma } = await build('OWNER', paidPlatform());
        const res = await patch(app, { status: 'CANCELLED' });
        expect(res.statusCode).toBe(200);
        expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ cancelledBy: 'BUSINESS', reason: 'dashboard' }));
        const statusFlips = prisma.booking.updateMany.mock.calls.filter((c: any[]) => c[0].data.status === 'CANCELLED');
        expect(statusFlips).toHaveLength(0);
    });

    it('notes sent with the cancellation are still saved', async () => {
        const { app, prisma } = await build('OWNER', row());
        await patch(app, { status: 'CANCELLED', notes: 'customer called' });
        expect(prisma.booking.updateMany).toHaveBeenCalledWith({
            where: { id: 'b1', tenantId: 't1' }, data: { notes: 'customer called' },
        });
    });

    it('a failed cancel (race) is reported, not silently 200', async () => {
        cancelMock.mockResolvedValue({ ok: false, reason: 'already_cancelled' });
        const { app } = await build('OWNER', row());
        expect((await patch(app, { status: 'CANCELLED' })).statusCode).toBe(400);
    });

    it('cancelling an unpaid held (PENDING_PAYMENT) booking by PATCH is unchanged: nothing to refund', async () => {
        const { app, prisma } = await build('STAFF', row({ status: 'PENDING_PAYMENT' }));
        const res = await patch(app, { status: 'CANCELLED' });
        expect(res.statusCode).toBe(200);
        expect(cancelMock).not.toHaveBeenCalled();
        expect(prisma.booking.updateMany).toHaveBeenCalled();
    });

    it('other status changes are unaffected', async () => {
        const { app } = await build('STAFF', row({ startTime: new Date(Date.now() - 3600_000), paymentStatus: 'PAID', collectionRoute: 'PLATFORM' }));
        expect((await patch(app, { status: 'COMPLETED' })).statusCode).toBe(200);
        expect(cancelMock).not.toHaveBeenCalled();
    });
});
