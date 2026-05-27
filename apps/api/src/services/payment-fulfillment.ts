/**
 * Shared payment-fulfillment logic.
 *
 * When a Paystack charge succeeds, the booking/order must flip UNPAID → PAID
 * and a fixed set of side effects must run exactly once (confirmation
 * template, reminder, calendar sync, audit log).
 *
 * This used to live inline in the webhook handler. It is extracted here so
 * BOTH the webhook (`POST /payments/webhook`) and the verify-on-return
 * fallback (`GET /public/payments/verify`) share one idempotent code path.
 *
 * Idempotency: the UNPAID → PAID transition is an atomic `updateMany` guarded
 * on `paymentStatus: 'UNPAID'`. Only the first caller sees `count === 1` and
 * runs the side effects; every later call (concurrent webhook, customer
 * refreshing the confirmation page) sees `count === 0` and is a no-op.
 */

import { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { TemplatePurpose } from '@prisma/client';
import { audit } from './audit.js';
import { scheduleNotification, scheduleReminder } from './notification.js';
import { syncBookingToCalendar } from './calendar.js';
import type { VerifyResult } from './paystack.js';

/** Minimal booking shape the fulfillment needs (matches the webhook select). */
export interface FulfillableBooking {
    id: string;
    bookingReference: string;
    customerName: string;
    customerPhone: string;
    startTime: Date;
    serviceId: string;
    service: { name: string };
}

/** Minimal order shape the fulfillment needs. */
export interface FulfillableOrder {
    id: string;
    orderRef: string;
    customerPhone: string;
    totalAmount: unknown; // Prisma Decimal — coerced via Number()
}

/** `applied` is true iff this call performed the UNPAID → PAID flip. */
export interface FulfillResult {
    applied: boolean;
}

/**
 * Flip a booking to PAID and run its post-payment side effects.
 * Safe to call repeatedly — only the first call that wins the atomic claim
 * runs the side effects.
 */
export async function fulfillBookingCharge(opts: {
    fastify: FastifyInstance;
    logger: FastifyBaseLogger;
    tenantId: string;
    booking: FulfillableBooking;
    verified: VerifyResult;
    reference: string;
}): Promise<FulfillResult> {
    const { fastify, logger, tenantId, booking, verified, reference } = opts;

    // Atomic claim: only the writer that sees UNPAID flips to PAID. A
    // concurrent delivery sees count === 0 and returns idempotently, so
    // side effects (template, calendar, audit) only run once per payment.
    const claimed = await fastify.prisma.booking.updateMany({
        where: { id: booking.id, paymentStatus: 'UNPAID' },
        data: {
            paymentStatus: 'PAID',
            paidAt: verified.paidAt ?? new Date(),
            status: 'CONFIRMED',
        },
    });
    if (claimed.count === 0) {
        return { applied: false };
    }

    // BOOKING_CONFIRMATION template (uses the existing purpose).
    const dateStr = booking.startTime.toLocaleDateString();
    const timeStr = booking.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await scheduleNotification({
        queue: fastify.queues.notifications,
        purpose: TemplatePurpose.BOOKING_CONFIRMATION,
        tenantId,
        customerPhone: booking.customerPhone,
        variables: [
            booking.customerName,
            booking.service.name,
            dateStr,
            timeStr,
            booking.bookingReference,
        ],
        jobId: `booking_confirmation_${booking.id}`,
    });

    // Reminder 60 min before. scheduleReminder no-ops on past times.
    await scheduleReminder({
        queue: fastify.queues.reminders,
        tenantId,
        bookingId: booking.id,
        customerPhone: booking.customerPhone,
        variables: [booking.service.name, timeStr],
        sendAt: new Date(booking.startTime.getTime() - 60 * 60 * 1000),
    });

    // Best-effort Google Calendar sync. On failure (token expired, OAuth
    // revoked, network), surface a dashboard notification so the operator
    // knows to reconnect — otherwise the booking is CONFIRMED in our system
    // but missing from the salon's calendar, which causes double-booking.
    await syncBookingToCalendar({
        bookingId: booking.id,
        tenantId,
        prisma: fastify.prisma,
    }).catch(async (err) => {
        logger.warn({ err, bookingId: booking.id }, 'Calendar sync failed post-payment');
        await fastify.prisma.notification.create({
            data: {
                tenantId,
                type: 'SYSTEM',
                title: 'Reconnect Google Calendar',
                message: `Booking ${booking.bookingReference} couldn't sync to your calendar. Reauthorize at /settings.`,
                metadata: {
                    bookingId: booking.id,
                    error: err instanceof Error ? err.message : String(err),
                },
            },
        }).catch(() => undefined);
    });

    await audit({
        prisma: fastify.prisma,
        action: 'payments.charge.success',
        actorType: 'SYSTEM',
        tenantId,
        targetType: 'Booking',
        targetId: booking.id,
        metadata: {
            entity: 'booking',
            reference,
            amountKobo: verified.amountKobo,
            currency: verified.currency,
            channel: verified.channel,
        },
    });

    return { applied: true };
}

/**
 * Flip an order to PAID and run its post-payment side effects.
 * Safe to call repeatedly — see `fulfillBookingCharge`.
 */
export async function fulfillOrderCharge(opts: {
    fastify: FastifyInstance;
    tenantId: string;
    order: FulfillableOrder;
    verified: VerifyResult;
    reference: string;
}): Promise<FulfillResult> {
    const { fastify, tenantId, order, verified, reference } = opts;

    // Atomic claim: same TOCTOU guard as the booking branch.
    const claimed = await fastify.prisma.order.updateMany({
        where: { id: order.id, paymentStatus: 'UNPAID' },
        data: {
            paymentStatus: 'PAID',
            paidAt: verified.paidAt ?? new Date(),
            status: 'CONFIRMED',
        },
    });
    if (claimed.count === 0) {
        return { applied: false };
    }

    await scheduleNotification({
        queue: fastify.queues.notifications,
        purpose: TemplatePurpose.ORDER_CONFIRMATION,
        tenantId,
        customerPhone: order.customerPhone,
        variables: [order.orderRef, Number(order.totalAmount).toFixed(2)],
        jobId: `order_confirmation_${order.id}`,
    });

    await audit({
        prisma: fastify.prisma,
        action: 'payments.charge.success',
        actorType: 'SYSTEM',
        tenantId,
        targetType: 'Order',
        targetId: order.id,
        metadata: {
            entity: 'order',
            reference,
            amountKobo: verified.amountKobo,
            currency: verified.currency,
            channel: verified.channel,
        },
    });

    return { applied: true };
}
