/**
 * Shared booking-cancellation logic.
 *
 * One function used by every cancel entry point — the WhatsApp bot's
 * CONFIRM_CANCEL state, the dashboard's `POST /bookings/:id/cancel`, and the
 * public SMS-link cancel endpoint — so all three produce identical DB state
 * and side effects (calendar event removed, reminder job dropped,
 * BOOKING_CANCELLED notification queued, in-app notification created).
 *
 * Callers own their own audit logging — the public endpoint, for instance,
 * audits with `actorType: 'SYSTEM'` and the request IP.
 */

import { Queue } from 'bullmq';
import { TemplatePurpose } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { scheduleNotification, cancelReminder } from './notification.js';
import { deleteCalendarEvent } from './calendar.js';

export type CancelBookingResult =
    | { ok: true; booking: { id: string; bookingReference: string; serviceName: string } }
    | { ok: false; reason: 'not_found' | 'already_cancelled' | 'not_cancellable' };

export interface CancelBookingArgs {
    prisma: ExtendedPrismaClient;
    bookingId: string;
    /** Free-text reason recorded on the in-app notification metadata. */
    reason: string;
    notificationsQueue?: Queue | null;
    remindersQueue?: Queue | null;
}

/**
 * Cancel a booking and fire all the standard side effects. Idempotent-ish:
 * a booking that is already CANCELLED returns `{ ok: false, reason }` rather
 * than throwing, so callers can render a friendly "already cancelled" state.
 */
export async function cancelBooking(args: CancelBookingArgs): Promise<CancelBookingResult> {
    const { prisma, bookingId, reason } = args;

    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { service: { select: { name: true } } },
    });

    if (!booking) {
        return { ok: false, reason: 'not_found' };
    }
    if (booking.status === 'CANCELLED') {
        return { ok: false, reason: 'already_cancelled' };
    }
    if (booking.status !== 'CONFIRMED') {
        // PENDING_PAYMENT / COMPLETED / NO_SHOW are not customer-cancellable.
        return { ok: false, reason: 'not_cancellable' };
    }

    await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED' },
    });

    // Best-effort: drop the linked Google Calendar event.
    if (booking.calendarEventId) {
        await deleteCalendarEvent(booking.id, booking.tenantId, prisma).catch(() => undefined);
    }

    // Best-effort: remove the pending reminder job so a cancelled booking
    // doesn't still trigger a reminder.
    await cancelReminder(args.remindersQueue ?? null, booking.id).catch(() => undefined);

    // Customer-facing confirmation — sent as a template so it survives the
    // 24-hour WhatsApp window closing.
    await scheduleNotification({
        queue: args.notificationsQueue ?? null,
        purpose: TemplatePurpose.BOOKING_CANCELLED,
        tenantId: booking.tenantId,
        customerPhone: booking.customerPhone,
        variables: [
            booking.service.name,
            booking.startTime.toLocaleDateString(),
        ],
        jobId: `booking_cancelled_${booking.id}`,
    }).catch(() => undefined);

    // In-app dashboard notification for the tenant.
    await prisma.notification.create({
        data: {
            tenantId: booking.tenantId,
            type: 'BOOKING_CANCELLED',
            title: 'Booking Cancelled',
            message: `Booking ${booking.bookingReference} has been cancelled`,
            metadata: { bookingId: booking.id, reason },
        },
    }).catch(() => undefined);

    return {
        ok: true,
        booking: {
            id: booking.id,
            bookingReference: booking.bookingReference,
            serviceName: booking.service.name,
        },
    };
}
