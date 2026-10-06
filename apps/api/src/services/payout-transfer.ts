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
 * transfer event can arrive more than once, and every transition is a
 * CONDITIONAL update on the status it expects. Nothing writes a status
 * unconditionally: that is how a late "handed to Paystack" update used to be
 * able to drag a payout the webhook had already settled back to PROCESSING.
 *
 * Contradictory events (success for a payout already returned to the tenant,
 * failure for one already settled) move NO money. They raise a critical alert,
 * because each is a double-pay or a lost-money risk only a person can resolve.
 *
 * Legal moves:
 *   REQUESTED  -> PROCESSING   (markPayoutProcessing)
 *   REQUESTED | PROCESSING -> PAID    (markPayoutPaid, transfer.success)
 *   REQUESTED | PROCESSING -> FAILED  (markPayoutFailed, transfer.failed / .reversed)
 *   PAID       -> FAILED       (markPayoutReversed, transfer.reversed after success:
 *                               the settlement is reversed back to available)
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { PaystackError } from './paystack.js';
import {
    payoutReversed,
    payoutSettled,
    payoutSettlementReversed,
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
    /** The wallet currency. A payout is only ever sent in the currency it was reserved in. */
    currency: string;
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
                currency: args.currency,
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
 * We handed the transfer to Paystack and it accepted it.
 *
 * The status move is guarded on REQUESTED, so it can never drag a payout back
 * from a state a webhook already settled (the transfer webhook can beat this
 * call home). The provider reference is recorded regardless, but only if there
 * is none yet, so reconciliation can always find the transfer.
 */
export async function markPayoutProcessing(args: {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    payoutId: string;
    transferCode: string;
}): Promise<{ advanced: boolean }> {
    const { prisma, tenantId, payoutId, transferCode } = args;
    const advanced = await prisma.payoutRequest.updateMany({
        where: { id: payoutId, tenantId, status: 'REQUESTED' },
        data: { status: 'PROCESSING', providerRef: transferCode },
    });
    if (advanced.count === 1) return { advanced: true };

    await prisma.payoutRequest.updateMany({
        where: { id: payoutId, tenantId, providerRef: null },
        data: { providerRef: transferCode },
    });
    return { advanced: false };
}

/** Current status of a payout, for explaining why a transition did not apply. */
async function currentStatus(
    client: ExtendedPrismaClient,
    args: SettleArgs,
): Promise<{ status: string; tenantId: string } | null> {
    return client.payoutRequest.findUnique({
        where: payoutWhere(args),
        select: { status: true, tenantId: true },
    });
}

/**
 * The provider confirmed the money left. Close the ledger entry that has been
 * sitting in PAYOUT_PENDING since the request.
 */
export async function markPayoutPaid(args: SettleArgs): Promise<{ applied: boolean }> {
    const { prisma, payoutId } = args;

    const outcome = await prisma.$transaction(async (tx) => {
        const client = tx as ExtendedPrismaClient;

        // Atomic claim — only the first delivery of a retried webhook does
        // the work, so the ledger cannot be written twice.
        const claimed = await client.payoutRequest.updateMany({
            where: { ...payoutWhere(args), status: { in: ['REQUESTED', 'PROCESSING'] } },
            data: { status: 'PAID', settledAt: new Date() },
        });
        if (claimed.count === 0) {
            const was = await currentStatus(client, args);
            // FAILED after a settlement was recorded means we saw this success
            // already and the settlement was reversed later (transfer.reversed):
            // this is a redelivery, not a contradiction. The ledger key is the
            // evidence; nothing the webhook echoes is trusted for it.
            const settledBefore = was?.status === 'FAILED'
                ? !!(await client.ledgerMovement.findUnique({
                    where: { idempotencyKey: `payout-settled:${payoutId}` },
                    select: { id: true },
                }))
                : false;
            return { applied: false, was, settledBefore };
        }

        const payout = await client.payoutRequest.findUnique({
            where: payoutWhere(args),
            select: { tenantId: true, walletId: true, amountMinor: true, currency: true },
        });
        if (!payout) return { applied: false, was: null, settledBefore: false };

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

        return { applied: true, was: null, settledBefore: false };
    });

    // The provider says the money LEFT, but we had already given it back to
    // the tenant. They now hold it twice. Nothing is moved automatically: a
    // person decides which side to claw back. Only a GENUINE contradiction: a
    // payout that was settled and then reversed, whose success event is
    // redelivered, stays silent. One alert per payout (dedupeKey).
    if (!outcome.applied && outcome.was?.status === 'FAILED' && !outcome.settledBefore) {
        await raiseAlert(prisma, {
            kind: 'payout.paid_after_failed',
            severity: 'critical',
            tenantId: outcome.was.tenantId,
            message: 'Paystack reports a transfer as SUCCESSFUL, but Bookly had already returned that payout to the tenant balance. The tenant may have been paid twice; reconcile by hand.',
            context: { payoutId },
            dedupeKey: `payout.paid_after_failed:${payoutId}`,
        });
    }

    return { applied: outcome.applied };
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
        if (claimed.count === 0) {
            return { applied: false, tenantId: null, amountMinor: 0, currency: 'GHS', was: await currentStatus(client, args) };
        }

        const payout = await client.payoutRequest.findUnique({
            where: payoutWhere(args),
            select: { tenantId: true, walletId: true, amountMinor: true, currency: true },
        });
        if (!payout) return { applied: false, tenantId: null, amountMinor: 0, currency: 'GHS', was: null };

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
            was: null,
        };
    });

    // A failure event for a payout that already SETTLED contradicts what we
    // recorded. Moving money on it could pay the tenant twice, so nothing
    // moves; a person is told.
    if (!result.applied && result.was?.status === 'PAID') {
        await raiseAlert(prisma, {
            kind: 'payout.event_conflict',
            severity: 'critical',
            tenantId: result.was.tenantId,
            message: 'Paystack reported a transfer as failed, but Bookly had already recorded it as paid. No money was moved; check the transfer with Paystack.',
            context: { payoutId, event: 'failed' },
            dedupeKey: `payout.event_conflict:${payoutId}:failed`,
        });
    }

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
 * `transfer.reversed`: Paystack took a transfer back.
 *
 * Before success it is just another failure. AFTER success it means the money
 * we recorded as gone came back to Bookly's balance, so the tenant is owed it
 * again: the settlement is reversed (EXTERNAL -> AVAILABLE), the payout is
 * marked FAILED, and a critical alert and an owner notification say so.
 * Ignoring it, as this used to, leaves Bookly holding money the ledger says
 * the tenant already received.
 *
 * Idempotent: the PAID -> FAILED claim is atomic and the movement is keyed on
 * the payout, so a redelivery finds a FAILED payout and does nothing.
 */
export async function markPayoutReversed(
    args: SettleArgs & { failureReason?: string },
): Promise<{ applied: boolean }> {
    const { prisma, payoutId } = args;
    const failureReason = args.failureReason ?? 'The transfer was reversed after it was sent.';

    const reversed = await prisma.$transaction(async (tx) => {
        const client = tx as ExtendedPrismaClient;

        const claimed = await client.payoutRequest.updateMany({
            where: { ...payoutWhere(args), status: 'PAID' },
            data: { status: 'FAILED', failureReason },
        });
        if (claimed.count === 0) return null;

        const payout = await client.payoutRequest.findUnique({
            where: payoutWhere(args),
            select: { tenantId: true, walletId: true, amountMinor: true, currency: true },
        });
        if (!payout) return null;

        await postMovement(client, {
            tenantId: payout.tenantId,
            walletId: payout.walletId,
            reason: 'PAYOUT_REVERSED',
            idempotencyKey: `payout-settlement-reversed:${payoutId}`,
            lines: payoutSettlementReversed(payout.amountMinor),
            currency: payout.currency,
            payoutId,
            note: 'transfer.reversed after the payout had settled',
        });
        await refreshCachedBalances(client, payout.tenantId, payout.walletId);
        return payout;
    });

    if (!reversed) {
        // Not settled: an ordinary failure (or a redelivery, which is a no-op).
        return markPayoutFailed(args);
    }

    await raiseAlert(prisma, {
        kind: 'payout.reversed_after_success',
        severity: 'critical',
        tenantId: reversed.tenantId,
        message: `A payout of ${reversed.currency} ${(reversed.amountMinor / 100).toFixed(2)} was reversed by Paystack AFTER it had been sent. The settlement was reversed and the funds returned to the tenant's available balance.`,
        context: { payoutId, amountMinor: reversed.amountMinor, currency: reversed.currency },
        dedupeKey: `payout.reversed_after_success:${payoutId}`,
    });
    await createNotification(
        prisma,
        {
            tenantId: reversed.tenantId,
            type: 'SYSTEM',
            title: 'A withdrawal was reversed',
            message: `${reversed.currency} ${(reversed.amountMinor / 100).toFixed(2)} was sent back by the network and is in your balance again. Check your Mobile Money number and try again.`,
            metadata: { payoutId },
        },
        args.logger,
    ).catch(() => undefined);

    return { applied: true };
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
