/**
 * Withdrawing money.
 *
 * This is the only place value leaves the system, so it is the place that
 * earns the most suspicion. Three things are load-bearing:
 *
 * 1. The balance is re-derived from the ledger INSIDE a serializable
 *    transaction. Reading it beforehand and trusting it is exactly the bug
 *    that lets two simultaneous requests each withdraw the full balance.
 * 2. Only one payout may be in flight at a time. That is a sensible rule for
 *    a salon, and it doubles as the guard against a double-tapped button.
 * 3. Velocity caps. A balance drained in a single day is the shape of a
 *    compromised account even when every individual request is affordable.
 *    The window is a ROLLING 24 hours: a calendar day resets at midnight and
 *    so allows twice the cap across the boundary.
 * 4. The recipient is SNAPSHOTTED here. The destination validated (usable,
 *    past cooling-off, has a provider code) is the one stored on the payout and
 *    the one returned for the transfer, so a destination change between the
 *    request and the send cannot redirect, or skip the cooling-off of, a payout
 *    that was already approved.
 * 5. The payout switch (admin pause) is checked first, and fails closed.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import {
    LedgerCurrencyMismatchError,
    deriveBalances,
    payoutRequested,
    postMovement,
    refreshCachedBalances,
    reportCurrencyMismatch,
} from './ledger.js';
import { destinationIsUsable } from './payout-recipient.js';
import { isPayoutsPaused } from './platform-switches.js';
import { scoped } from '../lib/logger.js';

const log = scoped('payout-request');

/** Paystack will not send less than GHS 1. */
export const MIN_PAYOUT_MINOR = 100;
/** Withdrawals per tenant per rolling 24 hours. */
export const MAX_DAILY_PAYOUTS = 5;
/** The velocity window. Rolling, not a calendar day. */
export const PAYOUT_WINDOW_MS = 24 * 3600_000;
/** Default ceiling on the total withdrawn in the window, in minor units. */
export const DEFAULT_MAX_DAILY_MINOR = 500_000;

export type WithdrawalRefusal =
    | 'invalid_amount'
    | 'below_minimum'
    | 'insufficient_funds'
    | 'destination_not_ready'
    | 'payout_in_flight'
    | 'daily_count_reached'
    | 'daily_limit_reached'
    | 'payouts_paused';

export interface WithdrawalCheckInput {
    amountMinor: number;
    /** Derived from the ledger, inside the transaction. Never a cached value. */
    availableMinor: number;
    destinationUsable: boolean;
    inFlightCount: number;
    payoutsToday: number;
    withdrawnTodayMinor: number;
    maxDailyMinor: number;
}

export type WithdrawalCheck =
    | { allowed: true }
    | { allowed: false; reason: WithdrawalRefusal };

/**
 * Decide whether this withdrawal may proceed.
 *
 * Pure, so every refusal is testable without a database. Order matters: the
 * owner is told the reason that actually explains the refusal, not whichever
 * rule happens to be checked first.
 */
export function checkWithdrawal(input: WithdrawalCheckInput): WithdrawalCheck {
    const {
        amountMinor, availableMinor, destinationUsable,
        inFlightCount, payoutsToday, withdrawnTodayMinor, maxDailyMinor,
    } = input;

    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        return { allowed: false, reason: 'invalid_amount' };
    }
    // Funds first: it is the reason that explains the refusal to a person.
    if (amountMinor > availableMinor) {
        return { allowed: false, reason: 'insufficient_funds' };
    }
    if (amountMinor < MIN_PAYOUT_MINOR) {
        return { allowed: false, reason: 'below_minimum' };
    }
    if (!destinationUsable) {
        return { allowed: false, reason: 'destination_not_ready' };
    }
    if (inFlightCount > 0) {
        return { allowed: false, reason: 'payout_in_flight' };
    }
    if (payoutsToday >= MAX_DAILY_PAYOUTS) {
        return { allowed: false, reason: 'daily_count_reached' };
    }
    if (withdrawnTodayMinor + amountMinor > maxDailyMinor) {
        return { allowed: false, reason: 'daily_limit_reached' };
    }
    return { allowed: true };
}

/** What to say to a salon owner. No jargon, and always a next action. */
export function refusalMessage(reason: WithdrawalRefusal, currency = 'GHS'): string {
    switch (reason) {
        case 'insufficient_funds':
            return 'That is more than you have ready to withdraw right now.';
        case 'below_minimum':
            return `The smallest amount you can send is ${currency} ${(MIN_PAYOUT_MINOR / 100).toFixed(2)}.`;
        case 'destination_not_ready':
            return 'Your new payout number is not active yet. For your safety it can receive money 24 hours after you change it.';
        case 'payout_in_flight':
            return 'You already have money on the way. Wait for it to arrive, then try again.';
        case 'daily_count_reached':
            return 'You have made all the withdrawals allowed in the last 24 hours. Try again later.';
        case 'daily_limit_reached':
            return 'That would go over the amount you can withdraw in 24 hours. Try a smaller amount, or wait a while.';
        case 'payouts_paused':
            return 'Withdrawals are paused right now. Your money is safe and still in your balance. Please contact support if you need it urgently.';
        case 'invalid_amount':
        default:
            return 'Enter an amount to withdraw.';
    }
}

export class WithdrawalRefusedError extends Error {
    constructor(public readonly reason: WithdrawalRefusal, message: string) {
        super(message);
        this.name = 'WithdrawalRefusedError';
    }
}

/** Raised when two withdrawals collide and the database aborts one. */
export class WithdrawalConflictError extends Error {
    constructor() {
        super('Another withdrawal was being processed. Please try again.');
        this.name = 'WithdrawalConflictError';
    }
}

export interface CreateWithdrawalArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    requestedByUserId: string;
    amountMinor: number;
    maxDailyMinor?: number;
    logger?: FastifyBaseLogger;
    /** Injectable clock for tests. */
    now?: Date;
}

export interface CreatedWithdrawal {
    payoutId: string;
    amountMinor: number;
    currency: string;
    /** The recipient validated for THIS payout. The transfer pays exactly this one. */
    recipientId: string;
    /** That recipient's provider code, read in the same transaction as the validation. */
    recipientCode: string;
}

/**
 * Commit a withdrawal: move the money out of available and record the request.
 *
 * Does NOT send anything. The transfer is a separate step, so a provider
 * failure can return the funds without having to unpick a half-written
 * ledger.
 */
export async function createWithdrawal(
    args: CreateWithdrawalArgs,
): Promise<CreatedWithdrawal> {
    const { prisma, tenantId, amountMinor } = args;
    const maxDailyMinor = args.maxDailyMinor ?? DEFAULT_MAX_DAILY_MINOR;
    const now = args.now ?? new Date();

    // The admin switch first: nothing below should even look at a balance
    // while payouts are paused. Failing to READ the switch refuses too, for
    // the same reason: paying out while unsure is the wrong way to fail.
    let pause: { paused: boolean; reason?: string };
    try {
        pause = await isPayoutsPaused(prisma, tenantId);
    } catch (err) {
        log.error({ err, tenantId }, 'Could not read the payout switch; refusing the withdrawal');
        pause = { paused: true };
    }
    if (pause.paused) {
        // The admin's reason is internal; the owner gets the plain message.
        if (pause.reason) log.warn({ tenantId, reason: pause.reason }, 'Withdrawal refused: payouts paused');
        throw new WithdrawalRefusedError('payouts_paused', refusalMessage('payouts_paused'));
    }

    try {
        return await prisma.$transaction(
            async (tx) => {
                const client = tx as ExtendedPrismaClient;

                const wallet = await client.wallet.findUnique({
                    where: { tenantId },
                    select: { id: true, currency: true },
                });
                if (!wallet) {
                    throw new WithdrawalRefusedError(
                        'insufficient_funds',
                        refusalMessage('insufficient_funds'),
                    );
                }

                const destination = await client.payoutRecipient.findFirst({
                    where: { tenantId, archivedAt: null },
                    orderBy: { createdAt: 'desc' },
                });

                // Everything below is read INSIDE the transaction. A balance
                // read before opening it is stale by definition, and that is
                // precisely the window a second request exploits.
                const balances = await deriveBalances(client, tenantId, wallet.currency);

                const since = new Date(now.getTime() - PAYOUT_WINDOW_MS);
                const todays = await client.payoutRequest.findMany({
                    where: { tenantId, createdAt: { gte: since } },
                    select: { amountMinor: true, status: true },
                });
                const inFlight = await client.payoutRequest.count({
                    where: { tenantId, status: { in: ['REQUESTED', 'PROCESSING'] } },
                });

                const check = checkWithdrawal({
                    amountMinor,
                    availableMinor: balances.availableMinor,
                    // A destination Paystack never gave a code for cannot be
                    // paid, whatever its cooling-off says.
                    destinationUsable: destinationIsUsable(destination) && !!destination?.providerCode,
                    inFlightCount: inFlight,
                    payoutsToday: todays.filter((p) => p.status !== 'FAILED').length,
                    withdrawnTodayMinor: todays
                        .filter((p) => p.status !== 'FAILED' && p.status !== 'CANCELLED')
                        .reduce((t, p) => t + p.amountMinor, 0),
                    maxDailyMinor,
                });

                if (!check.allowed) {
                    throw new WithdrawalRefusedError(
                        check.reason,
                        refusalMessage(check.reason, wallet.currency),
                    );
                }

                const payout = await client.payoutRequest.create({
                    data: {
                        tenantId,
                        walletId: wallet.id,
                        amountMinor,
                        currency: wallet.currency,
                        status: 'REQUESTED',
                        recipientId: destination!.id,
                        requestedByUserId: args.requestedByUserId,
                    },
                    select: { id: true },
                });

                // Ledger and payout row in the same transaction: the money
                // cannot leave available without a request recording why, and
                // a request cannot exist without the money being reserved.
                const posted = await postMovement(client, {
                    tenantId,
                    walletId: wallet.id,
                    reason: 'PAYOUT_REQUESTED',
                    idempotencyKey: `payout:${payout.id}`,
                    lines: payoutRequested(amountMinor),
                    currency: wallet.currency,
                    payoutId: payout.id,
                });
                if (posted.duplicate) {
                    // Impossible unless the payout id repeated. Abort rather
                    // than leave a request with no reservation behind it.
                    throw new WithdrawalConflictError();
                }

                await refreshCachedBalances(client, tenantId, wallet.id);

                return {
                    payoutId: payout.id,
                    amountMinor,
                    currency: wallet.currency,
                    recipientId: destination!.id,
                    recipientCode: destination!.providerCode!,
                };
            },
            // Serializable: Postgres aborts one of two colliding withdrawals
            // rather than letting both read the same balance.
            { isolationLevel: 'Serializable' },
        );
    } catch (err) {
        if (err instanceof WithdrawalRefusedError) throw err;
        if (err instanceof LedgerCurrencyMismatchError) {
            // The transaction rolled back, so nothing was reserved. Say so
            // from outside it, where the alert survives.
            await reportCurrencyMismatch(prisma, err);
            throw err;
        }
        if (isSerializationFailure(err)) {
            args.logger?.warn({ tenantId }, 'Concurrent withdrawal aborted by the database');
            throw new WithdrawalConflictError();
        }
        throw err;
    }
}

/** Postgres raises 40001 when it cannot serialize two transactions. */
function isSerializationFailure(err: unknown): boolean {
    const e = err as { code?: string; meta?: { code?: string } };
    // 40001 serialization failure, 40P01 deadlock (raised by the raw
    // SELECT ... FOR UPDATE in lockWallet). Prisma surfaces raw-query errors
    // as P2010 with the Postgres code in meta.code.
    const pg = e?.code === 'P2010' ? e.meta?.code : e?.code;
    return pg === '40001' || pg === '40P01' || e?.code === 'P2034';
}
