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
import { createNotification } from './notifications.js';
import { syncBookingToCalendar } from './calendar.js';
import type { VerifyResult } from './paystack.js';
import { creditDepositToWallet } from './wallet-credit.js';
import { publishEventOnce } from './events/emit.js';
import { raiseAlert } from './alerts.js';

/** Minimal booking shape the fulfillment needs (matches the webhook select). */
export interface FulfillableBooking {
    id: string;
    bookingReference: string;
    /** What this booking asked for. Compared against what actually arrived. */
    depositAmount?: unknown;
    /** Which account collected this, recorded when the link was created. */
    collectionRoute?: string | null;
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
    /** What this order asked for. Compared against what actually arrived. */
    totalAmount: unknown; // Prisma Decimal — coerced via Number()
    /** Which account collected this, recorded when the link was created. */
    collectionRoute?: string | null;
}


/**
 * Did the customer actually pay what was asked?
 *
 * Nothing compared these before, so any non-zero payment confirmed the
 * booking and credited the wallet with whatever turned up. The charge amount
 * is fixed at initialize time so an ordinary customer cannot drive this, but
 * partial payments exist on some channels and a mismatch would otherwise be
 * recorded silently as a correct balance.
 *
 * A small tolerance absorbs rounding between the decimal column and the
 * provider's integer minor units. Overpayment is accepted — refusing it would
 * strand a customer's money for being too generous.
 */
const UNDERPAYMENT_TOLERANCE_MINOR = 1;

export function isSufficientPayment(paidMinor: number, expected: unknown): boolean {
    if (expected === null || expected === undefined) return true; // nothing to compare
    const expectedMinor = Math.round(Number(expected) * 100);
    if (!Number.isFinite(expectedMinor) || expectedMinor <= 0) return true;
    return paidMinor >= expectedMinor - UNDERPAYMENT_TOLERANCE_MINOR;
}


/**
 * Credit the tenant's wallet for a platform-collected payment.
 *
 * Fires only for money that reached Bookly's own account — a payment into the
 * tenant's own gateway never touched our balance, so crediting it would invent
 * funds. Safe to retry: the movement is keyed on the provider reference.
 */
async function creditForPlatformPayment(opts: {
    fastify: FastifyInstance;
    logger: FastifyBaseLogger;
    tenantId: string;
    verified: VerifyResult;
    reference: string;
    storedRoute: string | null;
    bookingId?: string;
    orderId?: string;
}): Promise<void> {
    try {
        const credit = await creditDepositToWallet({
            prisma: opts.fastify.prisma,
            tenantId: opts.tenantId,
            grossMinor: opts.verified.amountKobo,
            currency: opts.verified.currency,
            reference: opts.reference,
            storedRoute: opts.storedRoute,
            bookingId: opts.bookingId ?? null,
            orderId: opts.orderId ?? null,
            logger: opts.logger,
        });
        if (credit.skippedReason === 'invalid_amount') {
            opts.logger.error({ reference: opts.reference }, 'Payment landed but the amount was unusable — wallet NOT credited');
        }
    } catch (err) {
        // Loud, because money arrived that nobody has been credited for. The
        // reconciliation path is: re-run with the same reference; the
        // movement key makes that a no-op if it did in fact succeed.
        opts.logger.error(
            { err, reference: opts.reference, tenantId: opts.tenantId },
            'Payment landed but crediting the wallet FAILED — replay this reference',
        );
    }
}

/** What a verified charge looks like as an event; `extra` carries bookingId / orderId. */
function paymentEventPayload(verified: Pick<VerifyResult, 'amountKobo' | 'currency'>, reference: string, extra: Record<string, unknown>): Record<string, unknown> {
    return {
        ...extra,
        paymentId: reference,
        amount: verified.amountKobo,
        currency: verified.currency,
        reference,
    };
}

/**
 * Record `payment.succeeded` once per reference, BEFORE the paid claim.
 *
 * A verified Paystack success is a fact whatever the claim does. Publishing
 * after the claim lost the event for good when the first attempt died in
 * between: the redelivery sees an already-PAID row and returns idempotently.
 * Published first and keyed by the reference, every redelivery (claim won or
 * lost) tries again and the unique key makes extra tries harmless.
 *
 * A failure is returned, not thrown: an events outage must never hold up
 * confirming the booking or crediting the money. The caller finishes the
 * fulfilment and then rethrows (settle), so the webhook answers with an error
 * and Paystack redelivers, which publishes the event.
 */
async function recordPaymentSucceeded(
    prisma: unknown,
    logger: { error: (obj: object, msg: string) => void },
    args: { tenantId: string; reference: string; verified: VerifyResult; extra: Record<string, unknown> },
): Promise<unknown | null> {
    return republishPaymentSucceeded({
        prisma,
        logger,
        tenantId: args.tenantId,
        reference: args.reference,
        amountMinor: args.verified.amountKobo,
        currency: args.verified.currency,
        extra: args.extra,
    });
}

/**
 * (Re)publish `payment.succeeded` for a charge whose row is already PAID.
 *
 * The fulfilment publishes before its claim, and rethrows when that publish
 * fails so Paystack redelivers. But a redelivery (or the customer's return
 * page) finds the row PAID and used to answer idempotently BEFORE any
 * publish, so an events outage lost the event for good. Every PAID
 * short-circuit therefore calls this: the dedupe key makes it a no-op when
 * the event exists and the first write when it does not.
 *
 * `amountMinor` / `currency` come from signature-verified webhook data or a
 * Paystack verify. Even a tenant using its own key, who could sign whatever
 * amount it likes, can only affect its own subscribers' events.
 *
 * Returns the error instead of throwing (see recordPaymentSucceeded). An
 * unusable amount or currency is skipped, not published: the fulfilment that
 * made the row PAID already published the real figures.
 */
export async function republishPaymentSucceeded(args: {
    prisma: unknown;
    logger: { error: (obj: object, msg: string) => void };
    tenantId: string;
    reference: string;
    amountMinor: number;
    currency: string;
    extra: Record<string, unknown>;
}): Promise<unknown | null> {
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0 || typeof args.currency !== 'string' || !args.currency) {
        return null;
    }
    try {
        await publishEventOnce(
            args.prisma,
            {
                tenantId: args.tenantId,
                type: 'payment.succeeded',
                payload: paymentEventPayload({ amountKobo: args.amountMinor, currency: args.currency }, args.reference, args.extra),
            },
            { field: 'reference', equals: args.reference },
        );
        return null;
    } catch (err) {
        args.logger.error({ err, reference: args.reference, tenantId: args.tenantId }, 'payment.succeeded not recorded; will throw after fulfilment so the delivery is retried');
        return err;
    }
}

/**
 * Has `payment.succeeded` already been written for this reference? Lets the
 * unauthenticated return page skip a Paystack round trip on every refresh.
 * Fails open (false): when unsure, the caller verifies and republishes, which
 * the unique key makes harmless.
 */
export async function recordedPaymentSucceeded(prisma: any, tenantId: string, reference: string): Promise<boolean> {
    try {
        const row = await prisma.domainEvent.findFirst({
            where: { tenantId, dedupeKey: `payment.succeeded:reference:${reference}` },
            select: { id: true },
        });
        return !!row;
    } catch {
        return false;
    }
}

/**
 * Verify-on-return companion of republishPaymentSucceeded: when the row is
 * already PAID and the event is not recorded, verify with Paystack and record
 * it. Never throws: the customer is answered as before whatever happens here.
 */
export async function ensurePaymentSucceededOnReturn(args: {
    prisma: any;
    logger: { error: (obj: object, msg: string) => void };
    tenantId: string;
    reference: string;
    verify: () => Promise<VerifyResult>;
    extra: Record<string, unknown>;
}): Promise<void> {
    try {
        if (await recordedPaymentSucceeded(args.prisma, args.tenantId, args.reference)) return;
        const verified = await args.verify();
        if (verified.status !== 'success') return;
        await republishPaymentSucceeded({
            prisma: args.prisma,
            logger: args.logger,
            tenantId: args.tenantId,
            reference: args.reference,
            amountMinor: verified.amountKobo,
            currency: verified.currency,
            extra: args.extra,
        });
    } catch (err) {
        args.logger.error({ err, reference: args.reference }, 'Could not re-record payment.succeeded on return');
    }
}

/**
 * Record `payment.failed` (underpaid) once per reference. Thrown on failure:
 * nothing was claimed, so the redelivery is safe and is the only way the event
 * is ever written.
 */
async function recordPaymentFailed(
    prisma: unknown,
    args: { tenantId: string; reference: string; verified: VerifyResult; extra: Record<string, unknown> },
): Promise<void> {
    await publishEventOnce(
        prisma,
        {
            tenantId: args.tenantId,
            type: 'payment.failed',
            payload: { ...paymentEventPayload(args.verified, args.reference, args.extra), reason: 'underpaid' },
        },
        { field: 'reference', equals: args.reference },
    );
}

/** Finish with the fulfilment result, unless the event could not be recorded. */
function settle(result: FulfillResult, eventError: unknown | null): FulfillResult {
    if (eventError) throw eventError;
    return result;
}

/**
 * A verified payment for a booking whose hold already expired (CANCELLED).
 *
 * Not confirmed and not rebooked: the slot may belong to someone else now.
 * The row is marked PAID (status untouched) so the payment is traceable and
 * so the refund path (which needs PAID + a reference) works. Money we hold
 * must have an owner and an exit: it is credited to the wallet as PENDING
 * exactly like any platform-collected deposit; PENDING is never withdrawable
 * and a CANCELLED booking never clears, so the only way out is a refund, which
 * the CRITICAL alert asks a person to do (or to rebook the customer).
 *
 * The alert goes FIRST: the claim above is what makes this run once, so a
 * crash after it must not be able to lose the only thing that tells a person.
 * (raiseAlert never throws.)
 */
async function handleLatePayment(opts: {
    fastify: FastifyInstance;
    logger: FastifyBaseLogger;
    tenantId: string;
    booking: FulfillableBooking;
    verified: VerifyResult;
    reference: string;
    storedRoute: string | null;
}): Promise<void> {
    const { fastify, logger, tenantId, booking, verified, reference } = opts;
    logger.error(
        { bookingId: booking.id, reference },
        'Payment arrived after the hold expired — booking NOT confirmed; refund or rebook',
    );
    await raiseAlert(fastify.prisma, {
        kind: 'payment.after_hold_expired',
        severity: 'critical',
        tenantId,
        message: `A payment arrived for booking ${booking.bookingReference} after its hold expired. It was not confirmed; refund the customer or rebook them.`,
        context: { bookingId: booking.id, bookingReference: booking.bookingReference, reference, amountMinor: verified.amountKobo, currency: verified.currency },
        dedupeKey: `payment.after_hold_expired:${tenantId}:${reference}`,
    });
    await creditForPlatformPayment({
        fastify, logger, tenantId, verified, reference, storedRoute: opts.storedRoute, bookingId: booking.id,
    });
    await audit({
        prisma: fastify.prisma,
        action: 'payments.charge.after_hold_expired',
        actorType: 'SYSTEM',
        tenantId,
        targetType: 'Booking',
        targetId: booking.id,
        metadata: { entity: 'booking', reference, amountKobo: verified.amountKobo, currency: verified.currency },
    });
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

    const entityCollectionRoute = booking.collectionRoute ?? null;

    // Refuse to confirm a booking that was underpaid. Marking it PAID would
    // hold the slot and credit the salon for money that never arrived.
    if (!isSufficientPayment(verified.amountKobo, booking.depositAmount)) {
        logger.error(
            { bookingId: booking.id, reference, paidMinor: verified.amountKobo },
            'Payment is less than the deposit asked for — NOT confirming or crediting',
        );
        await recordPaymentFailed(fastify.prisma, { tenantId, reference, verified, extra: { bookingId: booking.id } });
        return { applied: false };
    }

    // The success fact first (see recordPaymentSucceeded), whatever the claim does.
    const eventError = await recordPaymentSucceeded(fastify.prisma, logger, {
        tenantId, reference, verified, extra: { bookingId: booking.id },
    });

    // Atomic claim: only the writer that sees UNPAID flips to PAID. A
    // concurrent delivery sees count === 0 and returns idempotently, so
    // side effects (template, calendar, audit) only run once per payment.
    //
    // Guarded on the booking still being held (or already CONFIRMED with an
    // unpaid deposit): a hold that expired is CANCELLED and UNPAID, and
    // confirming it would resurrect a slot that may already be rebooked.
    const claimed = await fastify.prisma.booking.updateMany({
        where: { id: booking.id, paymentStatus: 'UNPAID', status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
        data: {
            paymentStatus: 'PAID',
            paidAt: verified.paidAt ?? new Date(),
            status: 'CONFIRMED',
        },
    });
    if (claimed.count === 0) {
        // Money that arrived for a booking that is no longer waiting for it.
        const late = await fastify.prisma.booking.updateMany({
            where: { id: booking.id, paymentStatus: 'UNPAID', status: { notIn: ['PENDING_PAYMENT', 'CONFIRMED'] } },
            data: { paymentStatus: 'PAID', paidAt: verified.paidAt ?? new Date() },
        });
        if (late.count === 1) {
            await handleLatePayment({ fastify, logger, tenantId, booking, verified, reference, storedRoute: entityCollectionRoute });
        }
        return settle({ applied: false }, eventError);
    }

    // Credit the wallet IMMEDIATELY after the claim and before any queue work.
    // The claim is what makes this run once, so anything that can throw
    // between the two loses the credit permanently: on retry the row is
    // already PAID, the webhook answers idempotent, and the customer's money
    // sits in Bookly's account with nobody credited for it.
    await creditForPlatformPayment({
        fastify,
        logger,
        tenantId,
        verified,
        reference,
        storedRoute: entityCollectionRoute,
        bookingId: booking.id,
    });

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

    // Tell the operator money landed. Best-effort: a failed notification must
    // never fail an already-captured payment. createNotification also publishes
    // the realtime event (in-app banner) and sends the mobile push.
    await createNotification(
        fastify.prisma,
        {
            tenantId,
            // NotificationType has no payment member; `kind` in metadata is what
            // the clients branch on. A dedicated enum value needs a migration.
            type: 'SYSTEM',
            title: 'Payment received',
            message: `${verified.currency} ${(verified.amountKobo / 100).toFixed(2)} paid for booking ${booking.bookingReference}.`,
            metadata: { kind: 'payment', bookingId: booking.id, reference },
        },
        logger,
    ).catch((err) => {
        logger.warn({ err, bookingId: booking.id }, 'Payment notification failed');
    });

    return settle({ applied: true }, eventError);
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

    const entityCollectionRoute = order.collectionRoute ?? null;

    if (!isSufficientPayment(verified.amountKobo, order.totalAmount)) {
        fastify.log.error(
            { orderId: order.id, reference, paidMinor: verified.amountKobo },
            'Payment is less than the order total — NOT fulfilling or crediting',
        );
        await recordPaymentFailed(fastify.prisma, { tenantId, reference, verified, extra: { orderId: order.id } });
        return { applied: false };
    }

    const eventError = await recordPaymentSucceeded(fastify.prisma, fastify.log, {
        tenantId, reference, verified, extra: { orderId: order.id },
    });

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
        return settle({ applied: false }, eventError);
    }

    // Same ordering as the booking path: credit before any queue work, so a
    // Redis blip cannot lose the credit behind an already-PAID row.
    await creditForPlatformPayment({
        fastify,
        logger: fastify.log,
        tenantId,
        verified,
        reference,
        storedRoute: entityCollectionRoute,
        orderId: order.id,
    });

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

    // See the booking branch: best-effort, never fails the payment.
    await createNotification(
        fastify.prisma,
        {
            tenantId,
            type: 'SYSTEM',
            title: 'Payment received',
            message: `${verified.currency} ${(verified.amountKobo / 100).toFixed(2)} paid for order ${order.orderRef}.`,
            metadata: { kind: 'payment', orderId: order.id, reference },
        },
        fastify.log,
    ).catch((err) => {
        fastify.log.warn({ err, orderId: order.id }, 'Payment notification failed');
    });

    return settle({ applied: true }, eventError);
}
