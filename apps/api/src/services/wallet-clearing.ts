/**
 * Releasing a tenant's money once the job is done.
 *
 * A deposit is conditional until the work happens: if it were withdrawable
 * immediately, Bookly would be funding every cancellation refund out of its
 * own balance. So deposits land as PENDING and move to AVAILABLE the moment
 * the owner marks the booking done.
 *
 * NO_SHOW clears too. That is the entire point of taking a deposit — the
 * customer did not turn up, so the money is the salon's compensation.
 *
 * Event-driven rather than a timer: they finish the job, the money is theirs.
 * Nothing to wait for and nothing to explain.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { fundsCleared, postMovement, refreshCachedBalances } from './ledger.js';

/** Booking states that release the money. */
export const CLEARING_BOOKING_STATUSES = ['COMPLETED', 'NO_SHOW'] as const;
/** Order state that releases the money. */
export const CLEARING_ORDER_STATUSES = ['DELIVERED'] as const;

export function bookingStatusClearsFunds(status: string): boolean {
    return (CLEARING_BOOKING_STATUSES as readonly string[]).includes(status);
}

export function orderStatusClearsFunds(status: string): boolean {
    return (CLEARING_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * How much of this entity's deposit is still sitting in pending.
 *
 * Summed from the ledger rather than read off the booking, because the ledger
 * is the only place that knows what was actually credited after fees — and
 * what may already have been cleared or refunded.
 */
export function pendingFromEntries(
    entries: readonly { account: string; amountMinor: number }[],
): number {
    return entries.reduce(
        (total, e) => (e.account === 'TENANT_PENDING' ? total + e.amountMinor : total),
        0,
    );
}

/** Who ended the booking. Decides who keeps the deposit. */
export type CancelledBy = 'CUSTOMER' | 'BUSINESS';

export type DepositOutcome =
    /** Non-refundable: the slot was held and then lost. Money is the salon's. */
    | 'FORFEIT_TO_BUSINESS'
    /** The salon let the customer down — it must not keep their money. */
    | 'HOLD_FOR_REFUND';

/**
 * Where a paid deposit goes when a booking is cancelled.
 *
 * Deposits are non-refundable by policy: a customer who cannot make it
 * reschedules rather than gets money back, and rescheduling keeps the same
 * booking so the deposit simply carries over.
 *
 * The one case policy cannot cover is the salon cancelling. Keeping a
 * customer's money for work nobody is going to do is indefensible however the
 * terms are written, so that money is held rather than released.
 */
export function depositOutcomeOnCancel(cancelledBy: CancelledBy): DepositOutcome {
    return cancelledBy === 'BUSINESS' ? 'HOLD_FOR_REFUND' : 'FORFEIT_TO_BUSINESS';
}

export interface ClearFundsArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    bookingId?: string | null;
    orderId?: string | null;
    logger?: FastifyBaseLogger;
}

export interface ClearFundsResult {
    cleared: boolean;
    amountMinor?: number;
    reason?: 'nothing_pending' | 'already_cleared' | 'no_wallet';
}

/**
 * Move this booking's (or order's) money from pending to withdrawable.
 *
 * Idempotent on the entity id, so marking a booking done twice — or a retry
 * after a partial failure — cannot release the money twice.
 */
export async function clearFundsForEntity(args: ClearFundsArgs): Promise<ClearFundsResult> {
    const { prisma, tenantId, bookingId, orderId } = args;
    if (!bookingId && !orderId) return { cleared: false, reason: 'nothing_pending' };

    const entityKey = bookingId ? `booking:${bookingId}` : `order:${orderId}`;

    return prisma.$transaction(async (tx) => {
        const client = tx as ExtendedPrismaClient;

        // Every movement touching this entity, so an amount already cleared
        // or refunded nets itself out and cannot be released a second time.
        const movements = await client.ledgerMovement.findMany({
            where: {
                tenantId,
                ...(bookingId ? { bookingId } : { orderId }),
            },
            select: { entries: { select: { account: true, amountMinor: true } } },
        });

        const pendingMinor = pendingFromEntries(movements.flatMap((m) => m.entries));
        if (pendingMinor <= 0) {
            return { cleared: false, reason: 'nothing_pending' as const };
        }

        const wallet = await client.wallet.findUnique({
            where: { tenantId },
            select: { id: true, currency: true },
        });
        if (!wallet) {
            // Pending funds without a wallet should be impossible — the wallet
            // is created when the deposit is credited.
            args.logger?.error({ tenantId, entityKey }, 'Pending funds but no wallet');
            return { cleared: false, reason: 'no_wallet' as const };
        }

        const posted = await postMovement(client, {
            tenantId,
            walletId: wallet.id,
            reason: 'FUNDS_CLEARED',
            idempotencyKey: `clear:${entityKey}`,
            lines: fundsCleared(pendingMinor),
            currency: wallet.currency,
            bookingId: bookingId ?? null,
            orderId: orderId ?? null,
        });

        if (posted.duplicate) {
            return { cleared: false, reason: 'already_cleared' as const };
        }

        await refreshCachedBalances(client, tenantId, wallet.id);
        return { cleared: true, amountMinor: pendingMinor };
    });
}
