/**
 * Retry refunds that failed after a salon cancelled a paid booking.
 *
 * `refundDepositForBooking` parks a failed refund in
 * `depositState = 'REFUND_PENDING'` with `refundNextAttemptAt` set by an
 * exponential backoff. This sweep picks the due ones up and tries again, so a
 * Paystack blip no longer leaves a customer's money stuck until a person reads
 * an alert. Same shape as `hold-expiry.ts`: in-process on a timer, no Redis.
 *
 * SAFE TO REPLAY, AND SAFE TO RUN ON TWO INSTANCES:
 *  - the parked deposit is claimed with an atomic conditional update
 *    (REFUND_PENDING -> REFUNDING), so only one sweeper gets it;
 *  - the ledger movement is keyed on the booking, so it cannot post twice;
 *  - a provider that says "already fully reversed" counts as success.
 *
 * It also rescues a deposit stranded in REFUNDING by a process that died
 * mid-refund (the claim is taken before the provider call), by parking it again.
 *
 * Alerting: a warning from the first failure, critical from attempt
 * `REFUND_ALERT_AFTER_ATTEMPTS`, and a critical `refund.retry_exhausted` when
 * the attempts run out (see wallet-refund.ts).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { raiseAlert } from './alerts.js';
import { refundDepositForBooking, type RefundDepositResult } from './wallet-refund.js';

const SWEEP_EVERY_MS = 60_000;
/** Bookings retried per sweep, so one bad day cannot turn a tick into a flood. */
const BATCH = 25;
/** A refund claim older than this belongs to a process that died. A refund call takes seconds. */
export const REFUND_STRANDED_AFTER_MS = 15 * 60_000;

/** Outcomes that mean "there is nothing to refund after all": stop retrying, tell a person. */
const NOTHING_TO_RETRY: ReadonlyArray<NonNullable<RefundDepositResult['reason']>> = [
    'nothing_to_refund',
    'not_platform_collected',
    'no_reference',
];

export interface RefundSweepResult {
    recovered: number;
    attempted: number;
    refunded: number;
    errored: number;
}

export async function retryDueRefunds(
    prisma: ExtendedPrismaClient,
    log?: FastifyBaseLogger,
    now: Date = new Date(),
): Promise<RefundSweepResult> {
    const result: RefundSweepResult = { recovered: 0, attempted: 0, refunded: 0, errored: 0 };

    const stranded = await prisma.booking.updateMany({
        where: { depositState: 'REFUNDING', updatedAt: { lt: new Date(now.getTime() - REFUND_STRANDED_AFTER_MS) } },
        data: { depositState: 'REFUND_PENDING', refundNextAttemptAt: now },
    });
    result.recovered = stranded.count;
    if (stranded.count > 0) log?.warn({ count: stranded.count }, 'Recovered refund claims stranded by a crashed attempt');

    const due = await prisma.booking.findMany({
        where: { depositState: 'REFUND_PENDING', refundNextAttemptAt: { lte: now } },
        orderBy: { refundNextAttemptAt: 'asc' },
        take: BATCH,
        select: { id: true, tenantId: true },
    });

    for (const b of due) {
        result.attempted += 1;
        try {
            const r = await refundDepositForBooking({
                prisma, tenantId: b.tenantId, bookingId: b.id, logger: log, retry: true, now,
            });
            if (r.refunded) result.refunded += 1;
            // 'claim_lost' is deliberately absent from NOTHING_TO_RETRY: another
            // sweeper holds the row and may re-park it; touching it here would
            // drop a live refund from the queue.
            if (!r.refunded && r.reason && NOTHING_TO_RETRY.includes(r.reason)) {
                await stopRetrying(prisma, b, r.reason);
            }
        } catch (err) {
            result.errored += 1;
            log?.error({ err, bookingId: b.id }, 'Refund retry threw');
        }
    }

    if (result.attempted > 0) log?.info(result, 'Refund retry sweep');
    return result;
}

/** Parked, but there is nothing to refund: do not loop every minute forever. */
async function stopRetrying(
    prisma: ExtendedPrismaClient,
    b: { id: string; tenantId: string },
    reason: string,
): Promise<void> {
    const stopped = await prisma.booking.updateMany({
        where: { id: b.id, tenantId: b.tenantId, depositState: 'REFUND_PENDING' },
        data: { refundNextAttemptAt: null, refundLastError: `skipped: ${reason}` },
    });
    // Nothing matched: the row is no longer parked (refunded or claimed by someone
    // else meanwhile). There is nothing dropped, so no alert.
    if (stopped.count === 0) return;
    await raiseAlert(prisma, {
        kind: 'refund.retry_skipped',
        severity: 'warning',
        tenantId: b.tenantId,
        message: `A parked refund was dropped from the retry queue: there was nothing left to refund (${reason}). Check the booking's money by hand.`,
        context: { bookingId: b.id, reason },
        dedupeKey: `refund.retry_skipped:${b.id}`,
    });
}

/**
 * Start the sweep. Returns a stop function.
 * Wire next to `startHoldExpirySweeper` in index.ts:
 *   stopRefundRetrySweeper = startRefundRetrySweeper(server.prisma, server.log);
 */
export function startRefundRetrySweeper(prisma: ExtendedPrismaClient, log: FastifyBaseLogger): () => void {
    let running = false;
    const timer = setInterval(() => {
        // A slow sweep must not be re-entered by the next tick: two sweeps on
        // the same rows would only fight over the claim.
        if (running) return;
        running = true;
        retryDueRefunds(prisma, log)
            .catch((err) => log.error({ err }, 'Refund retry sweep failed'))
            .finally(() => { running = false; });
    }, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
