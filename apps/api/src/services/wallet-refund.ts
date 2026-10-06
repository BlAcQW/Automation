/**
 * Refunding a deposit when the BUSINESS cancels.
 *
 * Deposits are non-refundable by policy — a customer who cannot make it
 * reschedules, which keeps the same booking and carries their money with it.
 * This file exists for the one case that policy cannot cover: the salon
 * cancelling work the customer had already paid for.
 *
 * The alternative to refunding is not "we keep it". It is a chargeback, which
 * costs the deposit anyway, plus a dispute fee, plus standing with Paystack.
 * Refunding voluntarily is strictly cheaper, so it happens automatically
 * rather than waiting for someone to notice a held balance.
 *
 * ORDER OF OPERATIONS MATTERS. The ledger is written only after the provider
 * confirms the refund. Writing it first would show money returned that is
 * still sitting in our balance.
 *
 * A FAILED REFUND IS RETRIED, NOT JUST ALERTED. The deposit is parked in
 * `depositState = 'REFUND_PENDING'` with an attempt counter and a next-attempt
 * time, and `services/refund-retry.ts` sweeps due ones with backoff. Parked
 * means neither a clearing nor a second refund can claim it (both claim only an
 * untouched deposit), so the money is safe while it waits. Replaying is safe
 * end to end: the ledger movement is keyed on the booking, and a provider that
 * reports the transaction already fully reversed is treated as a success.
 */

import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { refundTransaction } from './paystack.js';
import { postMovement, refreshCachedBalances, refundIssued } from './ledger.js';
import { pendingFromEntries } from './wallet-clearing.js';
import { raiseAlert } from './alerts.js';

/** Attempts after which the failure becomes a critical alert (it is a warning before). */
export const REFUND_ALERT_AFTER_ATTEMPTS = 5;
/** Attempts after which automatic retrying stops and a person must act. */
export const REFUND_MAX_ATTEMPTS = 12;

const MINUTE = 60_000;
const BACKOFF_MS = [1 * MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE, 3 * 60 * MINUTE, 6 * 60 * MINUTE];

/** How long to wait after the Nth failed attempt. Grows, then holds at 6 hours. */
export function refundBackoffMs(attempt: number): number {
    const i = Math.min(Math.max(Math.trunc(attempt), 1), BACKOFF_MS.length) - 1;
    return BACKOFF_MS[i];
}

/**
 * Paystack refuses to refund a transaction that is already fully refunded. On a
 * RETRY that means an earlier attempt went through (we only saw a timeout, or
 * our ledger write failed), so it is the outcome we wanted, not a failure.
 */
export function isAlreadyRefundedError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return /fully (reversed|refunded)|already (been )?(fully )?(refunded|reversed)/i.test(err.message);
}

/** Provider errors can echo request details; keep the stored copy short and key-free. */
export function scrubError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return raw.replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, '[redacted]').slice(0, 300);
}

export interface RefundDepositArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    bookingId: string;
    logger?: FastifyBaseLogger;
    /** True from the retry sweeper: claims a parked (REFUND_PENDING) deposit instead of an untouched one. */
    retry?: boolean;
    now?: Date;
}

export interface RefundDepositResult {
    refunded: boolean;
    amountMinor?: number;
    reason?:
        | 'nothing_to_refund'
        /**
         * Another actor holds or took the deposit (a sweeper, a clearing, a
         * parallel refund). NOT "nothing left": the sweeper must leave the row
         * alone, because the holder may yet re-park it for retry.
         */
        | 'claim_lost'
        | 'not_platform_collected'
        | 'no_reference'
        | 'already_refunded'
        | 'provider_failed'
        | 'ledger_failed';
}

/**
 * Park a deposit whose refund did not complete, so the sweeper retries it.
 * If even this write fails the deposit stays REFUNDING and the sweeper's
 * stranded-claim recovery picks it up, so nothing is lost either way.
 */
async function scheduleRefundRetry(opts: {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    bookingId: string;
    attempt: number;
    err: unknown;
    now: Date;
    logger?: FastifyBaseLogger;
}): Promise<void> {
    const { prisma, tenantId, bookingId, attempt, err, now } = opts;
    const exhausted = attempt >= REFUND_MAX_ATTEMPTS;
    try {
        await prisma.booking.updateMany({
            where: { id: bookingId, tenantId, depositState: 'REFUNDING' },
            data: {
                depositState: 'REFUND_PENDING',
                refundAttempts: attempt,
                refundNextAttemptAt: exhausted ? null : new Date(now.getTime() + refundBackoffMs(attempt)),
                refundLastError: scrubError(err),
            },
        });
    } catch (writeErr) {
        opts.logger?.error({ err: writeErr, bookingId }, 'Could not park a failed refund for retry; the stranded-claim recovery will');
    }
    if (exhausted) {
        await raiseAlert(prisma, {
            kind: 'refund.retry_exhausted',
            severity: 'critical',
            tenantId,
            message: `A refund for a cancelled booking failed ${attempt} times and will not be retried automatically. The customer is owed money.`,
            context: { bookingId, attempts: attempt, lastError: scrubError(err) },
            dedupeKey: `refund.retry_exhausted:${bookingId}`,
        });
    }
}

/**
 * Return a paid deposit to the customer and reverse the tenant's credit.
 *
 * Only handles money Bookly actually collected, decided by the route STORED on
 * the booking when its link was created. It is deliberately not re-derived
 * from the tenant's current Paystack key: connecting an own key after a
 * platform payment would otherwise silently skip the refund, and the customer
 * would never get their money.
 */
export async function refundDepositForBooking(
    args: RefundDepositArgs,
): Promise<RefundDepositResult> {
    const { prisma, tenantId, bookingId, logger } = args;
    const now = args.now ?? new Date();

    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, tenantId },
        select: { paymentStatus: true, paymentReference: true, collectionRoute: true, refundAttempts: true },
    });
    if (!booking || booking.paymentStatus !== 'PAID' || !booking.paymentReference) {
        return { refunded: false, reason: 'no_reference' };
    }
    if (booking.collectionRoute !== 'PLATFORM') {
        // Own gateway (we never held it) or an unknown route: fail closed.
        return { refunded: false, reason: 'not_platform_collected' };
    }
    const reference = booking.paymentReference;

    // What is actually still owed on this booking, from the ledger — not from
    // the booking row, which does not know about fees or prior movements.
    const movements = await prisma.ledgerMovement.findMany({
        where: { tenantId, bookingId },
        select: { entries: { select: { account: true, amountMinor: true } } },
    });
    const allEntries = movements.flatMap((m) => m.entries);
    const pendingMinor = pendingFromEntries(allEntries);

    if (movements.length === 0) {
        // Nothing was ever credited here, so this money never reached us.
        return { refunded: false, reason: 'not_platform_collected' };
    }
    if (pendingMinor <= 0) {
        // Already refunded, or already released to the salon. Either way there
        // is nothing of theirs left to take back.
        return { refunded: false, reason: 'nothing_to_refund' };
    }

    const feeMinor = allEntries.reduce(
        (t, e) => (e.account === 'PLATFORM_FEE' ? t + e.amountMinor : t),
        0,
    );

    // Claim the deposit BEFORE calling the provider. The refund takes about a
    // second, and without this a clearing that lands in that window releases
    // the same money to the salon — the customer gets refunded AND the salon
    // keeps it, with pending driven negative. A retry claims the parked state.
    const claimed = await prisma.booking.updateMany({
        where: { id: bookingId, tenantId, depositState: args.retry ? 'REFUND_PENDING' : null },
        data: { depositState: 'REFUNDING' },
    });
    if (claimed.count === 0) {
        return { refunded: false, reason: 'claim_lost' };
    }
    const attempt = (booking.refundAttempts ?? 0) + 1;

    // Provider first: the ledger must never claim money went back while it is
    // still in our balance.
    try {
        const secretKey = config.platformPaystack?.secretKey;
        if (!secretKey) throw new Error('platform_paystack_key_not_configured');
        await refundTransaction(secretKey, reference, pendingMinor + feeMinor, { merchantNote: `refund:booking:${bookingId}` });
    } catch (err) {
        if (!isAlreadyRefundedError(err)) {
            logger?.error(
                { err, bookingId, reference, attempt },
                'Salon cancelled a paid booking but the refund FAILED — will retry; customer is owed money',
            );
            await scheduleRefundRetry({ prisma, tenantId, bookingId, attempt, err, now, logger });
            await raiseAlert(prisma, {
                kind: 'refund.provider_failed',
                severity: attempt >= REFUND_ALERT_AFTER_ATTEMPTS ? 'critical' : 'warning',
                tenantId,
                message: `A paid booking was cancelled but the Paystack refund failed (attempt ${attempt}); it is being retried. The customer is owed money.`,
                context: { bookingId, reference, attempt, lastError: scrubError(err) },
                dedupeKey: `refund.provider_failed:${bookingId}`,
            });
            return { refunded: false, reason: 'provider_failed' };
        }
        logger?.warn({ bookingId, reference }, 'Provider reports the transaction already refunded; recording it');
    }

    let posted: { duplicate: boolean };
    try {
        posted = await prisma.$transaction(async (tx) => {
            const client = tx as ExtendedPrismaClient;
            const wallet = await client.wallet.findUnique({
                where: { tenantId },
                select: { id: true, currency: true },
            });
            if (!wallet) return { duplicate: true };

            const result = await postMovement(client, {
                tenantId,
                walletId: wallet.id,
                reason: 'REFUND_ISSUED',
                // Keyed on the booking, so a repeated cancellation cannot post a
                // second reversal even if the provider call is retried.
                idempotencyKey: `refund:booking:${bookingId}`,
                lines: refundIssued(pendingMinor, feeMinor, 'TENANT_PENDING'),
                currency: wallet.currency,
                bookingId,
            });
            if (!result.duplicate) {
                await refreshCachedBalances(client, tenantId, wallet.id);
            }
            return { duplicate: result.duplicate };
        });
    } catch (err) {
        // The customer HAS been refunded at the provider but our books do not
        // say so. Park it: the retry sees "already reversed" and only writes
        // the ledger. Critical, because until then the ledger overstates what
        // the tenant is owed.
        logger?.error({ err, bookingId, reference }, 'Refund went through at the provider but the ledger write FAILED');
        await scheduleRefundRetry({ prisma, tenantId, bookingId, attempt, err, now, logger });
        await raiseAlert(prisma, {
            kind: 'refund.ledger_failed',
            severity: 'critical',
            tenantId,
            message: 'A customer refund was sent but recording it in the ledger failed. It will be retried; until then the tenant balance is overstated.',
            context: { bookingId, reference, attempt, lastError: scrubError(err) },
            dedupeKey: `refund.ledger_failed:${bookingId}`,
        });
        return { refunded: false, reason: 'ledger_failed' };
    }

    await prisma.booking.updateMany({
        where: { id: bookingId, tenantId },
        data: { depositState: 'REFUNDED', refundNextAttemptAt: null, refundLastError: null },
    }).catch(() => undefined);

    if (posted.duplicate) return { refunded: false, reason: 'already_refunded' };
    return { refunded: true, amountMinor: pendingMinor + feeMinor };
}
