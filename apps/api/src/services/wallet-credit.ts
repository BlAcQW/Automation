/**
 * Crediting a tenant's wallet when a customer's payment lands.
 *
 * Only money collected into BOOKLY's Paystack account may credit a wallet.
 * Payments into a tenant's own gateway never touch our balance, so crediting
 * for those would invent funds we do not hold and could not pay out — the
 * ledger would balance while the bank account did not.
 *
 * Deposits land as PENDING. They become withdrawable when the owner marks the
 * job done, which is what makes a cancellation refundable without Bookly
 * funding it.
 */

import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import {
    LedgerCurrencyMismatchError,
    depositReceived,
    ensureWallet,
    postMovement,
    refreshCachedBalances,
    reportCurrencyMismatch,
    splitFee,
} from './ledger.js';

/**
 * Did this money land in Bookly's account?
 *
 * Read ONLY from the route recorded on the booking or order when the payment
 * link was created. It deliberately does not look at the reference prefix or
 * the provider's metadata.
 *
 * Both of those are attacker-controlled the moment a tenant connects their own
 * Paystack key: they can mint a transaction in their OWN account carrying any
 * reference and any metadata, have it verified against their own key, and —
 * if the route were inferred — have Bookly credit a wallet for money that
 * never arrived, then withdraw it from Bookly's real balance.
 *
 * Anything other than an explicit stored PLATFORM fails closed. Leaving money
 * uncredited is recoverable; crediting money we never received is not.
 */
export function isPlatformCollected(storedRoute: string | null | undefined): boolean {
    return storedRoute === 'PLATFORM';
}

/**
 * Derived from the provider's reference, never generated. A generated key
 * would let a redelivered webhook credit the same payment twice.
 */
export function depositIdempotencyKey(reference: string): string {
    return `deposit:${reference}`;
}

/** Bookly's cut, as basis points. 0 means the fee is switched off. */
export function platformFeeBps(): number {
    const raw = config.platformFeeBps;
    return Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export interface CreditDepositArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    /** Minor units, exactly as the provider reported them. */
    grossMinor: number;
    currency: string;
    reference: string;
    /** The route stored on the entity when the link was created. */
    storedRoute: string | null | undefined;
    bookingId?: string | null;
    orderId?: string | null;
    logger?: FastifyBaseLogger;
}

export interface CreditDepositResult {
    credited: boolean;
    /** Set when skipped, so the caller can log a reason rather than a silence. */
    skippedReason?: 'not_platform_collected' | 'already_credited' | 'invalid_amount' | 'currency_mismatch';
    netMinor?: number;
    feeMinor?: number;
}

/**
 * Credit a settled payment to the tenant's wallet.
 *
 * Safe to call more than once for the same reference: the movement's
 * idempotency key is unique in the database, so a second attempt is a no-op
 * rather than a double credit. That means a failed call can simply be retried.
 */
export async function creditDepositToWallet(
    args: CreditDepositArgs,
): Promise<CreditDepositResult> {
    if (!isPlatformCollected(args.storedRoute)) {
        return { credited: false, skippedReason: 'not_platform_collected' };
    }
    if (!Number.isInteger(args.grossMinor) || args.grossMinor <= 0) {
        args.logger?.error(
            { reference: args.reference, grossMinor: args.grossMinor },
            'Refusing to credit wallet: provider reported a non-positive amount',
        );
        return { credited: false, skippedReason: 'invalid_amount' };
    }

    const feeMinor = splitFee(args.grossMinor, platformFeeBps());
    const netMinor = args.grossMinor - feeMinor;

    // One transaction: wallet, movement and cached balances move together or
    // not at all, so a crash cannot leave a credited ledger with a stale
    // balance or an orphaned wallet.
    try {
        return await postCredit(args, feeMinor, netMinor);
    } catch (err) {
        // A charge in a different currency from the wallet is never summed
        // into it. The refusal rolled the transaction back, so the alert is
        // raised here on the root client, where it survives.
        if (err instanceof LedgerCurrencyMismatchError) {
            await reportCurrencyMismatch(args.prisma, err);
            return { credited: false, skippedReason: 'currency_mismatch' };
        }
        throw err;
    }
}

async function postCredit(
    args: CreditDepositArgs,
    feeMinor: number,
    netMinor: number,
): Promise<CreditDepositResult> {
    return args.prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(tx as ExtendedPrismaClient, args.tenantId, args.currency);

        const posted = await postMovement(tx as ExtendedPrismaClient, {
            tenantId: args.tenantId,
            walletId: wallet.id,
            reason: 'DEPOSIT_RECEIVED',
            idempotencyKey: depositIdempotencyKey(args.reference),
            lines: depositReceived(args.grossMinor, feeMinor),
            currency: args.currency,
            bookingId: args.bookingId ?? null,
            orderId: args.orderId ?? null,
        });

        if (posted.duplicate) {
            return { credited: false, skippedReason: 'already_credited' as const };
        }

        await refreshCachedBalances(tx as ExtendedPrismaClient, args.tenantId, wallet.id);
        return { credited: true, netMinor, feeMinor };
    });
}
