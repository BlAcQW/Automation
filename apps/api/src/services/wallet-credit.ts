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
    depositReceived,
    ensureWallet,
    postMovement,
    refreshCachedBalances,
    splitFee,
} from './ledger.js';

/** What `createPaymentLink` stamps on the reference for each route. */
const PLATFORM_PREFIX = 'bf_p_';
const OWN_GATEWAY_PREFIX = 'bf_o_';

/**
 * Did this money land in Bookly's account?
 *
 * Metadata is authoritative when present; the reference prefix is the fallback
 * for provider replays that arrive without it. Anything unrecognised — every
 * payment taken before this feature shipped — is treated as NOT ours, because
 * failing closed leaves money uncredited (fixable) while failing open credits
 * money we never received (not fixable).
 */
export function isPlatformCollected(
    reference: string,
    metadata: { collectionRoute?: unknown } | null | undefined,
): boolean {
    const declared = metadata?.collectionRoute;
    if (declared === 'PLATFORM') return true;
    if (declared === 'OWN_GATEWAY') return false;

    if (reference.startsWith(PLATFORM_PREFIX)) return true;
    if (reference.startsWith(OWN_GATEWAY_PREFIX)) return false;
    return false;
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
    metadata?: { collectionRoute?: unknown } | null;
    bookingId?: string | null;
    orderId?: string | null;
    logger?: FastifyBaseLogger;
}

export interface CreditDepositResult {
    credited: boolean;
    /** Set when skipped, so the caller can log a reason rather than a silence. */
    skippedReason?: 'not_platform_collected' | 'already_credited' | 'invalid_amount';
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
    if (!isPlatformCollected(args.reference, args.metadata)) {
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
