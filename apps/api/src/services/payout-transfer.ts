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
import { raiseAlert } from './alerts.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

/**
 * Paystack definitively refused. The money did NOT leave, so returning it to
 * the tenant's balance is correct.
 */
export class TransferRejectedError extends Error {
    constructor(public readonly detail: string) {
        super(detail);
        this.name = 'TransferRejectedError';
    }
}

/**
 * We do not know whether Paystack accepted it — a timeout, a 5xx, or a reply
 * we could not parse.
 *
 * This must NEVER reverse the payout. The transfer may well be on its way, and
 * returning the funds as well would pay the tenant twice: once into their
 * MoMo and once back into their balance. Leave it in flight and let the
 * webhook or a reconciliation decide.
 */
export class TransferUncertainError extends Error {
    constructor(public readonly detail: string) {
        super(detail);
        this.name = 'TransferUncertainError';
    }
}

/** Give up on a hung connection rather than hanging the caller's request. */
const TRANSFER_TIMEOUT_MS = 20_000;

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
            signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
        });
    } catch (err) {
        // A network error or timeout tells us nothing about whether Paystack
        // accepted the transfer. Uncertain, never rejected.
        throw new TransferUncertainError(`network_error: ${(err as Error).message}`);
    }

    const raw = await res.text().catch(() => '');
    let body: { status?: boolean; message?: string; data?: { transfer_code?: string; status?: string } } | null = null;
    try {
        body = raw ? JSON.parse(raw) : null;
    } catch {
        throw new TransferUncertainError(`unparseable_response_http_${res.status}`);
    }

    // A 4xx with an explicit status:false is Paystack saying no. Anything else
    // that went wrong — 5xx, a missing body, a shape we did not expect — could
    // still have been accepted.
    if (res.status >= 400 && res.status < 500 && body?.status === false) {
        throw new TransferRejectedError(body.message ?? `rejected_http_${res.status}`);
    }
    if (!res.ok || !body?.status || !body.data?.transfer_code) {
        throw new TransferUncertainError(body?.message ?? `indeterminate_http_${res.status}`);
    }

    return { transferCode: body.data.transfer_code, status: body.data.status ?? 'pending' };
}

export interface SettleArgs {
    prisma: ExtendedPrismaClient;
    payoutId: string;
    /**
     * REQUIRED when called from an authenticated request (e.g. the withdraw
     * route reversing a rejected transfer): every payout query is then scoped
     * to it, and the tenant guard would otherwise block the reversal. Omitted
     * only by the Paystack webhook, which runs without tenant context.
     */
    tenantId?: string;
    logger?: FastifyBaseLogger;
}

/** Payout where-clause, tenant-scoped whenever the caller knows the tenant. */
function payoutWhere(args: SettleArgs): { id: string; tenantId?: string } {
    return args.tenantId ? { id: args.payoutId, tenantId: args.tenantId } : { id: args.payoutId };
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
 * of what they check. An authenticated caller MUST pass `tenantId`, which
 * scopes every query below; without it tenant A could settle or reverse
 * tenant B's payout by id (and the tenant guard blocks the attempt).
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
            where: { ...payoutWhere(args), status: { in: ['REQUESTED', 'PROCESSING'] } },
            data: { status: 'PAID', settledAt: new Date() },
        });
        if (claimed.count === 0) return { applied: false };

        const payout = await client.payoutRequest.findUnique({
            where: payoutWhere(args),
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
            where: { ...payoutWhere(args), status: { in: ['REQUESTED', 'PROCESSING'] } },
            data: {
                status: 'FAILED',
                failureReason: args.failureReason ?? 'The transfer did not go through.',
            },
        });
        if (claimed.count === 0) return { applied: false, tenantId: null, amountMinor: 0, currency: 'GHS' };

        const payout = await client.payoutRequest.findUnique({
            where: payoutWhere(args),
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
        await raiseAlert(prisma, {
            kind: 'payout.failed',
            severity: 'critical',
            tenantId: result.tenantId,
            message: `A payout of ${result.currency} ${(result.amountMinor / 100).toFixed(2)} failed or was reversed and the funds were returned to the tenant.`,
            context: { payoutId, failureReason: args.failureReason ?? null },
            dedupeKey: `payout.failed:${payoutId}`,
        });
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

/**
 * A transfer whose outcome we cannot know (timeout, 5xx, unparseable reply).
 * The payout stays in flight on purpose, so a human must reconcile it against
 * Paystack. Call this wherever TransferUncertainError is caught.
 */
export async function reportTransferUncertain(args: {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    payoutId: string;
    detail: string;
}): Promise<void> {
    await raiseAlert(args.prisma, {
        kind: 'payout.uncertain',
        severity: 'critical',
        tenantId: args.tenantId,
        message: 'A payout transfer has an unknown outcome; reconcile with Paystack before retrying.',
        context: { payoutId: args.payoutId, detail: args.detail },
        dedupeKey: `payout.uncertain:${args.payoutId}`,
    });
}
