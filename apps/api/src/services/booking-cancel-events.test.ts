import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());
vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('./notifications.js', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('./notification.js', () => ({ scheduleNotification: vi.fn(async () => undefined), cancelReminder: vi.fn(async () => undefined) }));
vi.mock('./calendar.js', () => ({ deleteCalendarEvent: vi.fn(async () => undefined) }));
const outcome = vi.hoisted(() => ({ value: 'FORFEIT_TO_BUSINESS' }));
vi.mock('./alerts.js', () => ({ raiseAlert: vi.fn(async () => undefined) }));
vi.mock('./wallet-clearing.js', () => ({
    clearFundsForEntity: vi.fn(async () => undefined),
    depositOutcomeOnCancel: () => outcome.value,
}));
vi.mock('./wallet-refund.js', () => ({ refundDepositForBooking: vi.fn(async () => undefined) }));

import { publishEvent } from './events/publish.js';
import { cancelBooking } from './booking-cancel.js';
import { releaseExpiredHolds } from './hold-expiry.js';
import { refundDepositForBooking } from './wallet-refund.js';
import { clearFundsForEntity } from './wallet-clearing.js';
import { scheduleNotification } from './notification.js';
import { raiseAlert } from './alerts.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

const row = (over: Record<string, unknown> = {}) => ({
    id: 'b1', tenantId: 't1', status: 'CONFIRMED', bookingReference: 'BK-1', calendarEventId: null,
    customerPhone: '+233241234567', startTime: new Date('2030-01-01T10:00:00Z'), service: { name: 'Cut' }, ...over,
});

function prismaWith(booking: any) {
    return {
        booking: {
            findFirst: vi.fn(async () => booking),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
    } as any;
}

beforeEach(() => {
    vi.clearAllMocks();
    outcome.value = 'FORFEIT_TO_BUSINESS';
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('booking.cancelled event', () => {
    it('is published when a booking is cancelled, with the reason', async () => {
        const r = await cancelBooking({ prisma: prismaWith(row()), bookingId: 'b1', tenantId: 't1', reason: 'dashboard', cancelledBy: 'BUSINESS' });
        expect(r.ok).toBe(true);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toMatchObject({
            tenantId: 't1', type: 'booking.cancelled', payload: { v: 1, bookingId: 'b1', reason: 'dashboard' },
        });
    });

    it.each(['CANCELLED', 'PENDING_PAYMENT', 'COMPLETED'])('is NOT published for a booking that is %s (nothing changed)', async (status) => {
        const r = await cancelBooking({ prisma: prismaWith(row({ status })), bookingId: 'b1', tenantId: 't1', reason: 'x', cancelledBy: 'CUSTOMER' });
        expect(r.ok).toBe(false);
        expect(publish).not.toHaveBeenCalled();
    });

    it('is not published for an unknown booking', async () => {
        await cancelBooking({ prisma: prismaWith(null), bookingId: 'nope', tenantId: 't1', reason: 'x', cancelledBy: 'CUSTOMER' });
        expect(publish).not.toHaveBeenCalled();
    });

    it('guards the status flip on CONFIRMED, so only one of two racing cancels wins', async () => {
        const prisma = prismaWith(row());
        await cancelBooking({ prisma, bookingId: 'b1', tenantId: 't1', reason: 'x', cancelledBy: 'CUSTOMER' });
        expect(prisma.booking.updateMany).toHaveBeenCalledWith({
            where: { id: 'b1', tenantId: 't1', status: 'CONFIRMED' },
            data: { status: 'CANCELLED' },
        });
    });

    it('the LOSER of a double-cancel race (count 0) publishes nothing, notifies nobody and moves no money', async () => {
        const prisma = prismaWith(row());
        prisma.booking.updateMany.mockResolvedValue({ count: 0 });
        const r = await cancelBooking({ prisma, bookingId: 'b1', tenantId: 't1', reason: 'x', cancelledBy: 'CUSTOMER' });
        expect(r).toEqual({ ok: false, reason: 'already_cancelled' });
        expect(publish).not.toHaveBeenCalled();
        expect(scheduleNotification).not.toHaveBeenCalled();
        expect(clearFundsForEntity).not.toHaveBeenCalled();
        expect(refundDepositForBooking).not.toHaveBeenCalled();
    });

    it('two concurrent cancels: exactly one booking.cancelled and one refund/clearing', async () => {
        let status = 'CONFIRMED';
        const prisma: any = {
            booking: {
                findFirst: vi.fn(async () => row({ status })),
                updateMany: vi.fn(async ({ where }: any) => {
                    if (status !== where.status) return { count: 0 };
                    status = 'CANCELLED';
                    return { count: 1 };
                }),
            },
        };
        const args = { prisma, bookingId: 'b1', tenantId: 't1', reason: 'x', cancelledBy: 'CUSTOMER' as const };
        const [a, b] = await Promise.all([cancelBooking(args), cancelBooking(args)]);
        expect([a.ok, b.ok].sort()).toEqual([false, true]);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(clearFundsForEntity).toHaveBeenCalledTimes(1);
    });

    it('never fails the cancellation when the publish throws', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const r = await cancelBooking({ prisma: prismaWith(row()), bookingId: 'b1', tenantId: 't1', reason: 'x', cancelledBy: 'CUSTOMER' });
        expect(r.ok).toBe(true);
    });
});

describe('hold expiry', () => {
    it('publishes booking.cancelled (deposit_timeout) for each hold it releases', async () => {
        const prisma: any = {
            booking: {
                findMany: vi.fn(async () => [
                    { id: 'b1', tenantId: 't1', bookingReference: 'BK-1', customerName: 'A', notes: null },
                    { id: 'b2', tenantId: 't2', bookingReference: 'BK-2', customerName: 'B', notes: null },
                ]),
                updateMany: vi.fn(async ({ where }: any) => ({ count: where.id === 'b2' ? 0 : 1 })), // b2 was paid meanwhile
            },
        };
        await releaseExpiredHolds(prisma);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toMatchObject({
            tenantId: 't1', type: 'booking.cancelled', payload: { v: 1, bookingId: 'b1', reason: 'deposit_timeout' },
        });
    });
});

describe('money step failing after a winning cancel', () => {
    const cancel = (cancelledBy: 'CUSTOMER' | 'BUSINESS') =>
        cancelBooking({ prisma: prismaWith(row()), bookingId: 'b1', tenantId: 't1', reason: 'x', cancelledBy });

    it('a refund that throws still cancels, but raises a CRITICAL alert carrying the bookingId', async () => {
        outcome.value = 'REFUND_TO_CUSTOMER';
        (refundDepositForBooking as any).mockRejectedValueOnce(new Error('db down'));
        const r = await cancel('BUSINESS');
        expect(r.ok).toBe(true);
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect((raiseAlert as any).mock.calls[0][1]).toMatchObject({
            kind: 'refund.after_cancel_failed', severity: 'critical', tenantId: 't1',
            dedupeKey: 'refund.after_cancel_failed:b1', context: expect.objectContaining({ bookingId: 'b1' }),
        });
    });

    it('a forfeit that throws still cancels, but raises forfeit.after_cancel_failed', async () => {
        (clearFundsForEntity as any).mockRejectedValueOnce(new Error('db down'));
        const r = await cancel('CUSTOMER');
        expect(r.ok).toBe(true);
        expect((raiseAlert as any).mock.calls[0][1]).toMatchObject({
            kind: 'forfeit.after_cancel_failed', severity: 'critical', dedupeKey: 'forfeit.after_cancel_failed:b1',
            context: expect.objectContaining({ bookingId: 'b1' }),
        });
    });

    it('the success paths raise nothing', async () => {
        await cancel('CUSTOMER');
        outcome.value = 'REFUND_TO_CUSTOMER';
        await cancel('BUSINESS');
        expect(raiseAlert).not.toHaveBeenCalled();
        expect(clearFundsForEntity).toHaveBeenCalledTimes(1);
        expect(refundDepositForBooking).toHaveBeenCalledTimes(1);
    });
});
