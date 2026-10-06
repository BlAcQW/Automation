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
import { createNotification } from './notifications.js';
import { clearFundsForEntity, depositOutcomeOnCancel, type CancelledBy } from './wallet-clearing.js';
import { refundDepositForBooking } from './wallet-refund.js';
import { scheduleNotification, cancelReminder } from './notification.js';
import { deleteCalendarEvent } from './calendar.js';
import { emitBookingCancelled } from './events/emit.js';
import { raiseAlert } from './alerts.js';
import { scoped } from '../lib/logger.js';

const log = scoped('booking-cancel');

export type CancelBookingResult =
    | { ok: true; booking: { id: string; bookingReference: string; serviceName: string } }
    | { ok: false; reason: 'not_found' | 'already_cancelled' | 'not_cancellable' };

export interface CancelBookingArgs {
    prisma: ExtendedPrismaClient;
    bookingId: string;
    /** Owning tenant. Every booking query is scoped by it (tenant guard). */
    tenantId: string;
    /** Free-text reason recorded on the in-app notification metadata. */
    reason: string;
    /**
     * Who ended it. Required, with no default, because it decides who keeps
     * the deposit — and a default would quietly pick one.
     */
    cancelledBy: CancelledBy;
    notificationsQueue?: Queue | null;
    remindersQueue?: Queue | null;
}

/**
 * The booking is already CANCELLED (that flip is the claim), so a refund or
 * forfeit that throws afterwards is never retried by itself. Say so loudly,
 * with the bookingId, so a person can refund or release the money.
 */
async function reportMoneyStepFailed(
    prisma: ExtendedPrismaClient,
    step: 'refund' | 'forfeit',
    tenantId: string,
    bookingId: string,
    err: unknown,
): Promise<void> {
    log.error({ err, bookingId, tenantId }, `Booking cancelled but the ${step} step FAILED — a person must act`);
    await raiseAlert(prisma, {
        kind: `${step}.after_cancel_failed`,
        severity: 'critical',
        tenantId,
        message: step === 'refund'
            ? 'A paid booking was cancelled but the deposit refund failed. The customer is owed money.'
            : 'A paid booking was cancelled by the customer but releasing the forfeited deposit failed.',
        context: { bookingId, error: err instanceof Error ? err.message : String(err) },
        dedupeKey: `${step}.after_cancel_failed:${bookingId}`,
    });
}

/**
 * Cancel a booking and fire all the standard side effects. Idempotent-ish:
 * a booking that is already CANCELLED returns `{ ok: false, reason }` rather
 * than throwing, so callers can render a friendly "already cancelled" state.
 */
export async function cancelBooking(args: CancelBookingArgs): Promise<CancelBookingResult> {
    const { prisma, bookingId, tenantId, reason, cancelledBy } = args;

    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, tenantId },
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

    // The flip is the claim. Guarded on the status checked above, so of two
    // racing cancels exactly one sees count === 1; the loser stops here, before
    // the event, the notifications and, above all, the refund / forfeit.
    const { count } = await prisma.booking.updateMany({
        where: { id: bookingId, tenantId, status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
    });
    if (count !== 1) {
        return { ok: false, reason: 'already_cancelled' };
    }

    await emitBookingCancelled(prisma, { tenantId, bookingId, reason });

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

    // In-app dashboard notification for the tenant + mobile push.
    await createNotification(prisma, {
        tenantId: booking.tenantId,
        type: 'BOOKING_CANCELLED',
        title: 'Booking Cancelled',
        message: `Booking ${booking.bookingReference} has been cancelled`,
        metadata: { bookingId: booking.id, reason },
    }).catch(() => undefined);

    // Deposits are non-refundable: a customer who cancels forfeits it, which
    // is what makes holding the slot worth anything. Rescheduling keeps the
    // same booking, so a customer who simply moves their time keeps their
    // money — no ledger movement happens at all.
    //
    // When the SALON cancels, the money stays pending instead. It is not
    // released to them, because keeping a customer's money for work nobody
    // will do is indefensible however the terms are written.
    if (depositOutcomeOnCancel(cancelledBy) === 'FORFEIT_TO_BUSINESS') {
        await clearFundsForEntity({
            prisma,
            tenantId: booking.tenantId,
            bookingId: booking.id,
        }).catch((err) => reportMoneyStepFailed(prisma, 'forfeit', booking.tenantId, booking.id, err));
        // Never block the cancellation on the ledger — the booking really is
        // cancelled. But a failure here is not silent: the status flip was the
        // claim, so nothing retries this, and a person has to act.
    } else {
        // The salon cancelled, so the customer gets their money back —
        // automatically, not as a held balance waiting for someone to notice.
        // A deposit held with no owner and no exit is a leak, and the
        // alternative to refunding is a chargeback that costs more.
        //
        // Safe because a salon cancels BEFORE the job is done, so the money is
        // always still pending: never already released, never already
        // withdrawn.
        await refundDepositForBooking({
            prisma,
            tenantId: booking.tenantId,
            bookingId: booking.id,
        }).catch((err) => reportMoneyStepFailed(prisma, 'refund', booking.tenantId, booking.id, err));
        // The cancellation itself must still succeed. A provider failure is
        // alerted inside the service; an exception that escapes it is alerted
        // here, because the flip above means nothing will ever retry it.
    }

    return {
        ok: true,
        booking: {
            id: booking.id,
            bookingReference: booking.bookingReference,
            serviceName: booking.service.name,
        },
    };
}
