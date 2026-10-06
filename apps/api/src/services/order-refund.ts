/**
 * Refunding an ORDER payment that has no order left to pay for.
 *
 * The case this exists for: the customer paid after the order was cancelled or
 * expired (`handleLateOrderPayment` in payment-fulfillment.ts). The money
 * arrived, the goods are not coming, so it goes straight back. Mirrors
 * `refundDepositForBooking` (wallet-refund.ts), with one deliberate difference:
 *
 * NO RETRY COLUMNS ON ORDER. Booking has refundAttempts / refundNextAttemptAt
 * and a sweeper; Order only has `depositState`. So a failed refund is parked in
 * `depositState = 'REFUND_PENDING'` (which keeps clearing and a second refund
 * off it: both claim only an untouched row) and a CRITICAL alert names the
 * orderId. A PERSON re-runs it with `retry: true`; nothing retries it
 * automatically. A claim stranded in REFUNDING by a crash is also left for a
 * person (the alert from the late-payment handler is already out).
 *
 * Same safety properties as the booking path:
 *  - the order is claimed (atomic, guarded update) BEFORE the provider call, so
 *    a clearing cannot release the money being refunded;
 *  - refunded on the route STORED on the order, never re-derived from the
 *    tenant's current key; anything but PLATFORM fails closed;
 *  - the ledger is written only after the provider confirms, keyed
 *    `refund:order:<id>`, so a replay cannot post twice;
 *  - "already fully reversed" from the provider counts as success.
 */

import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { refundTransaction } from './paystack.js';
import { postMovement, refreshCachedBalances, refundIssued } from './ledger.js';
import { pendingFromEntries } from './wallet-clearing.js';
import { raiseAlert } from './alerts.js';
import { isAlreadyRefundedError, scrubError } from './wallet-refund.js';

export interface RefundOrderArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    orderId: string;
    logger?: FastifyBaseLogger;
    /** Claim a parked (REFUND_PENDING) order instead of an untouched one. A person sets this. */
    retry?: boolean;
    /** Payment reference to use if the order row does not carry one. */
    reference?: string;
    now?: Date;
}

export interface RefundOrderResult {
    refunded: boolean;
    amountMinor?: number;
    reason?:
        | 'nothing_to_refund'
        | 'claim_lost'
        | 'not_platform_collected'
        | 'no_reference'
        | 'not_cancelled'
        | 'already_refunded'
        | 'provider_failed'
        | 'ledger_failed';
}

/** Park the order so nothing else can claim it; the alert is what gets a person to act. */
async function park(prisma: ExtendedPrismaClient, tenantId: string, orderId: string, logger?: FastifyBaseLogger): Promise<void> {
    try {
        await prisma.order.updateMany({
            where: { id: orderId, tenantId, depositState: 'REFUNDING' },
            data: { depositState: 'REFUND_PENDING' },
        });
    } catch (err) {
        logger?.error({ err, orderId }, 'Could not park a failed order refund');
    }
}

export async function refundOrderPayment(args: RefundOrderArgs): Promise<RefundOrderResult> {
    const { prisma, tenantId, orderId, logger } = args;

    const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
        select: { status: true, paymentStatus: true, paymentReference: true, collectionRoute: true },
    });
    const reference = order?.paymentReference ?? args.reference ?? null;
    if (!order || order.paymentStatus !== 'PAID' || !reference) {
        return { refunded: false, reason: 'no_reference' };
    }
    // Only an order that no longer exists as a sale is refunded here. A live
    // order's money is released by clearing when it is delivered.
    if (order.status !== 'CANCELLED') return { refunded: false, reason: 'not_cancelled' };
    if (order.collectionRoute !== 'PLATFORM') {
        // Own gateway (we never held it) or an unknown route: fail closed.
        return { refunded: false, reason: 'not_platform_collected' };
    }

    const movements = await prisma.ledgerMovement.findMany({
        where: { tenantId, orderId },
        select: { entries: { select: { account: true, amountMinor: true } } },
    });
    const allEntries = movements.flatMap((m) => m.entries);
    if (movements.length === 0) {
        // Nothing was credited here, so this money never reached our books.
        return { refunded: false, reason: 'not_platform_collected' };
    }
    const pendingMinor = pendingFromEntries(allEntries);
    if (pendingMinor <= 0) return { refunded: false, reason: 'nothing_to_refund' };
    const feeMinor = allEntries.reduce((t, e) => (e.account === 'PLATFORM_FEE' ? t + e.amountMinor : t), 0);

    const claimed = await prisma.order.updateMany({
        where: { id: orderId, tenantId, depositState: args.retry ? 'REFUND_PENDING' : null },
        data: { depositState: 'REFUNDING' },
    });
    if (claimed.count === 0) return { refunded: false, reason: 'claim_lost' };

    try {
        const secretKey = config.platformPaystack?.secretKey;
        if (!secretKey) throw new Error('platform_paystack_key_not_configured');
        await refundTransaction(secretKey, reference, pendingMinor + feeMinor, { merchantNote: `refund:order:${orderId}` });
    } catch (err) {
        if (!isAlreadyRefundedError(err)) {
            logger?.error({ err, orderId, reference }, 'Order refund FAILED at the provider; money left pending, customer is owed it');
            await park(prisma, tenantId, orderId, logger);
            await raiseAlert(prisma, {
                kind: 'order.refund_failed',
                severity: 'critical',
                tenantId,
                message: 'A customer paid for an order that was already cancelled and the automatic Paystack refund failed. The money is held (pending) and the customer is owed it: a person must retry the order refund.',
                context: { orderId, reference, amountMinor: pendingMinor + feeMinor, lastError: scrubError(err) },
                dedupeKey: `order.refund_failed:${orderId}`,
            });
            return { refunded: false, reason: 'provider_failed' };
        }
        logger?.warn({ orderId, reference }, 'Provider reports the order transaction already refunded; recording it');
    }

    let posted: { duplicate: boolean };
    try {
        posted = await prisma.$transaction(async (tx) => {
            const client = tx as ExtendedPrismaClient;
            const wallet = await client.wallet.findUnique({ where: { tenantId }, select: { id: true, currency: true } });
            if (!wallet) return { duplicate: true };
            const result = await postMovement(client, {
                tenantId,
                walletId: wallet.id,
                reason: 'REFUND_ISSUED',
                idempotencyKey: `refund:order:${orderId}`,
                lines: refundIssued(pendingMinor, feeMinor, 'TENANT_PENDING'),
                currency: wallet.currency,
                orderId,
            });
            if (!result.duplicate) await refreshCachedBalances(client, tenantId, wallet.id);
            return { duplicate: result.duplicate };
        });
    } catch (err) {
        logger?.error({ err, orderId, reference }, 'Order refund went through at the provider but the ledger write FAILED');
        await park(prisma, tenantId, orderId, logger);
        await raiseAlert(prisma, {
            kind: 'order.refund_ledger_failed',
            severity: 'critical',
            tenantId,
            message: 'An order refund was sent to the customer but recording it in the ledger failed; the tenant balance is overstated until a person retries the order refund (the provider answers "already reversed", only the ledger is written).',
            context: { orderId, reference, lastError: scrubError(err) },
            dedupeKey: `order.refund_ledger_failed:${orderId}`,
        });
        return { refunded: false, reason: 'ledger_failed' };
    }

    await prisma.order.updateMany({
        where: { id: orderId, tenantId },
        data: { depositState: 'REFUNDED' },
    }).catch(() => undefined);

    if (posted.duplicate) return { refunded: false, reason: 'already_refunded' };
    return { refunded: true, amountMinor: pendingMinor + feeMinor };
}
