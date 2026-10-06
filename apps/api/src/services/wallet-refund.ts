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
 */

import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { refundTransaction } from './paystack.js';
import { resolveCollectionRoute } from './collection-route.js';
import { postMovement, refreshCachedBalances, refundIssued } from './ledger.js';
import { pendingFromEntries } from './wallet-clearing.js';
import { raiseAlert } from './alerts.js';

export interface RefundDepositArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    bookingId: string;
    logger?: FastifyBaseLogger;
}

export interface RefundDepositResult {
    refunded: boolean;
    amountMinor?: number;
    reason?:
        | 'nothing_to_refund'
        | 'not_platform_collected'
        | 'no_reference'
        | 'already_refunded'
        | 'provider_failed';
}

/**
 * Return a paid deposit to the customer and reverse the tenant's credit.
 *
 * Only handles money Bookly actually collected. A payment into the tenant's
 * own gateway is not ours to refund — we never held it — so the salon has to
 * settle that themselves.
 */
export async function refundDepositForBooking(
    args: RefundDepositArgs,
): Promise<RefundDepositResult> {
    const { prisma, tenantId, bookingId, logger } = args;

    const booking = await prisma.booking.findFirst({
        where: { id: bookingId, tenantId },
        select: { paymentStatus: true, paymentReference: true },
    });
    if (!booking || booking.paymentStatus !== 'PAID' || !booking.paymentReference) {
        return { refunded: false, reason: 'no_reference' };
    }

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

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { paystackSecretKey: true },
    });
    const route = resolveCollectionRoute(
        { tenantSecretKeyEncrypted: tenant?.paystackSecretKey ?? null },
        config.platformPaystack?.secretKey,
    );
    if (!route || route.route !== 'PLATFORM') {
        return { refunded: false, reason: 'not_platform_collected' };
    }

    // Claim the deposit BEFORE calling the provider. The refund takes about a
    // second, and without this a clearing that lands in that window releases
    // the same money to the salon — the customer gets refunded AND the salon
    // keeps it, with pending driven negative.
    const claimed = await prisma.booking.updateMany({
        where: { id: bookingId, tenantId, depositState: null },
        data: { depositState: 'REFUNDING' },
    });
    if (claimed.count === 0) {
        return { refunded: false, reason: 'nothing_to_refund' };
    }

    // Provider first: the ledger must never claim money went back while it is
    // still in our balance.
    try {
        await refundTransaction(route.secretKey, booking.paymentReference, pendingMinor + feeMinor);
    } catch (err) {
        // Release the claim so a retry can pick it up. Leaving it REFUNDING
        // would strand the deposit where neither path can touch it.
        await prisma.booking.updateMany({
            where: { id: bookingId, tenantId, depositState: 'REFUNDING' },
            data: { depositState: null },
        }).catch(() => undefined);
        logger?.error(
            { err, bookingId, reference: booking.paymentReference },
            'Salon cancelled a paid booking but the refund FAILED — customer is owed money',
        );
        await raiseAlert(prisma, {
            kind: 'refund.provider_failed',
            severity: 'critical',
            tenantId,
            message: 'A paid booking was cancelled but the Paystack refund failed; the customer is owed money.',
            context: { bookingId, reference: booking.paymentReference },
            dedupeKey: `refund.provider_failed:${bookingId}`,
        });
        return { refunded: false, reason: 'provider_failed' };
    }

    const posted = await prisma.$transaction(async (tx) => {
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

    await prisma.booking.updateMany({
        where: { id: bookingId, tenantId },
        data: { depositState: 'REFUNDED' },
    }).catch(() => undefined);

    if (posted.duplicate) return { refunded: false, reason: 'already_refunded' };
    return { refunded: true, amountMinor: pendingMinor + feeMinor };
}
