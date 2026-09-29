/**
 * Actually sending a withdrawal to the owner's Mobile Money.
 *
 * Split from the withdrawal request on purpose. Reserving the money and
 * sending it are separate steps so that a provider failure returns the funds
 * cleanly instead of leaving a half-written ledger to unpick.
 *
 * The state machine:
 *
 *   REQUESTED   money reserved, nothing sent yet
 *   PROCESSING  handed to Paystack
 *   PAID        provider confirmed — money is gone
 *   FAILED      provider rejected or reversed — money returned to available
 *
 * Every transition is idempotent, because Paystack retries webhooks and a
 * transfer event can arrive more than once.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { PaystackError } from './paystack.js';
import {
    payoutReversed,
    payoutSettled,
    postMovement,
    refreshCachedBalances,
} from './ledger.js';
import { createNotification } from './notifications.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

export interface InitiatedTransfer {
    transferCode: string;
    status: string;
}

/**
 * Hand the money to Paystack.
 *
 * `reference` is our payout id, so the webhook can find the request again
 * without trusting anything the provider echoes back.
 */
export async function initiateTransfer(args: {
    secretKey: string;
    recipientCode: string;
    amountMinor: number;
    reference: string;
    reason?: string;
}): Promise<InitiatedTransfer> {
    let res: Response;
    try {
        res = await fetch(`${PAYSTACK_BASE}/transfer`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${args.secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                source: 'balance',
                recipient: args.recipientCode,
                amount: args.amountMinor,
                reference: args.reference,
                reason: args.reason ?? 'Bookly payout',
            }),
        });
    } catch (err) {
        throw new PaystackError('config', `transfer_network_error: ${(err as Error).message}`);
    }

    const body = (await res.json().catch(() => null)) as
        | { status?: boolean; message?: string; data?: { transfer_code?: string; status?: string } }
        | null;

    if (!res.ok || !body?.status || !body.data?.transfer_code) {
        throw new PaystackError('config', body?.message ?? `transfer_http_${res.status}`);
    }

    return { transferCode: body.data.transfer_code, status: body.data.status ?? 'pending' };
}

export interface SettleArgs {
    prisma: ExtendedPrismaClient;
    payoutId: string;
    logger?: FastifyBaseLogger;
}

/**
 * CALLER INVARIANT — read before using the two functions below.
 *
 * They resolve a payout by id ALONE, with no tenant scope, because the only
 * caller is the Paystack webhook, which learns the tenant FROM the payout and
 * so has nothing to scope by.
 *
 * That is safe for exactly two reasons, both of which must keep holding:
 *   1. the webhook verifies the signature against the PLATFORM key before
 *      calling either, so the payout id cannot be attacker-supplied; and
 *   2. payout ids are cuids, so they cannot be guessed.
 *
 * They are therefore safe because of WHERE they are called from, not because
 * of what they check. Calling either from an authenticated route would be a
 * cross-tenant hole: tenant A could settle or reverse tenant B's payout by id.
 * If you need that, add a tenantId argument and filter on it.
 */

/**
 * The provider confirmed the money left. Close the ledger entry that has been
 * sitting in PAYOUT_PENDING since the request.
 */
export async function markPayoutPaid(args: SettleArgs): Promise<{ applied: boolean }> {
    const { prisma, payoutId } = args;

    return prisma.$transaction(async (tx) => {
        const client = tx as ExtendedPrismaClient;

        // Atomic claim — only the first delivery of a retried webhook does
        // the work, so the ledger cannot be written twice.
        const claimed = await client.payoutRequest.updateMany({
            where: { id: payoutId, status: { in: ['REQUESTED', 'PROCESSING'] } },
            data: { status: 'PAID', settledAt: new Date() },
        });
        if (claimed.count === 0) return { applied: false };

        const payout = await client.payoutRequest.findUnique({
            where: { id: payoutId },
            select: { tenantId: true, walletId: true, amountMinor: true, currency: true },
        });
        if (!payout) return { applied: false };

        await postMovement(client, {
            tenantId: payout.tenantId,
            walletId: payout.walletId,
            reason: 'PAYOUT_SETTLED',
            idempotencyKey: `payout-settled:${payoutId}`,
            lines: payoutSettled(payout.amountMinor),
            currency: payout.currency,
            payoutId,
        });
        await refreshCachedBalances(client, payout.tenantId, payout.walletId);

        return { applied: true };
    });
}

/**
 * The provider rejected or reversed it. Put the money back where it came from
 * so the owner can try again — a failed payout must leave them exactly where
 * they started.
 */
export async function markPayoutFailed(
    args: SettleArgs & { failureReason?: string },
): Promise<{ applied: boolean }> {
    const { prisma, payoutId } = args;

    const result = await prisma.$transaction(async (tx) => {
        const client = tx as ExtendedPrismaClient;

        const claimed = await client.payoutRequest.updateMany({
            where: { id: payoutId, status: { in: ['REQUESTED', 'PROCESSING'] } },
            data: {
                status: 'FAILED',
                failureReason: args.failureReason ?? 'The transfer did not go through.',
            },
        });
        if (claimed.count === 0) return { applied: false, tenantId: null, amountMinor: 0, currency: 'GHS' };

        const payout = await client.payoutRequest.findUnique({
            where: { id: payoutId },
            select: { tenantId: true, walletId: true, amountMinor: true, currency: true },
        });
        if (!payout) return { applied: false, tenantId: null, amountMinor: 0, currency: 'GHS' };

        await postMovement(client, {
            tenantId: payout.tenantId,
            walletId: payout.walletId,
            reason: 'PAYOUT_REVERSED',
            idempotencyKey: `payout-reversed:${payoutId}`,
            lines: payoutReversed(payout.amountMinor),
            currency: payout.currency,
            payoutId,
        });
        await refreshCachedBalances(client, payout.tenantId, payout.walletId);

        return {
            applied: true,
            tenantId: payout.tenantId,
            amountMinor: payout.amountMinor,
            currency: payout.currency,
        };
    });

    // Say so out loud. Money that quietly failed to arrive is the single
    // worst silence in the product.
    if (result.applied && result.tenantId) {
        await createNotification(
            prisma,
            {
                tenantId: result.tenantId,
                type: 'SYSTEM',
                title: 'Your withdrawal did not go through',
                message: `${result.currency} ${(result.amountMinor / 100).toFixed(2)} is back in your balance. Check your Mobile Money number and try again.`,
                metadata: { payoutId },
            },
            args.logger,
        ).catch(() => undefined);
    }

    return { applied: result.applied };
}
