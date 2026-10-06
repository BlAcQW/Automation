/**
 * Registry of payment fulfillers for verticals beyond bookings and orders
 * (e.g. rides: 'ride_package', 'ride_payg').
 *
 * HOW A PAYMENT FINDS ITS FULFILLER
 * The payment link carries `metadata.fulfillmentKind` + `metadata.entityId`
 * (see createFulfillmentPaymentLink). After the Paystack webhook signature is
 * verified, and only when the charge matches neither the booking nor the order
 * path, the webhook re-verifies the transaction with Paystack and dispatches
 * to the fulfiller registered for that kind.
 *
 * FULFILLER CONTRACT (read before registering one)
 *  1. IDEMPOTENT PER REFERENCE. Paystack retries and redelivers; the same
 *     reference WILL arrive more than once, possibly concurrently. Claim the
 *     payment atomically, e.g. an `updateMany` guarded on the current state
 *     (only the writer seeing count === 1 applies side effects) or a unique
 *     constraint on `reference`. Never check-then-write. A second call must
 *     return { status: 'already_applied' } and change nothing.
 *  2. VERIFY THE AMOUNT. The dispatcher passes the amount/currency Paystack
 *     itself reports, but compares it to nothing. The fulfiller must load its
 *     own entity (scoped by tenantId AND entityId) and check amountMinor and
 *     currency against what was owed, returning { status: 'rejected' } on a
 *     mismatch. Never trust metadata for amounts.
 *  3. TENANT SCOPE. Every query must filter by the supplied tenantId.
 *  4. THROW only for transient failures (DB down). A throw becomes a 5xx so
 *     Paystack retries; combined with (1) that is safe. Permanent problems
 *     (unknown entity, wrong amount) must be returned as 'rejected'.
 *  5. OWN_GATEWAY ONLY. These payments are verified with the tenant's own
 *     Paystack key and never touch the platform ledger. A fulfiller must not
 *     credit a wallet.
 */

import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import type { VerifyResult } from './paystack.js';

/** Kinds owned by the built-in webhook paths; never registerable. */
export const RESERVED_FULFILLMENT_KINDS = ['booking', 'order'] as const;

const KIND_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_ENTITY_ID_LENGTH = 100;

export interface FulfillerLogger {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
}

export interface FulfillmentInput {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    entityId: string;
    /** Paystack reference: the idempotency key. */
    reference: string;
    /** Minor units, as reported by Paystack's verify call. */
    amountMinor: number;
    currency: string;
    log: FulfillerLogger;
    /** Paystack's transaction id and payment channel, for the record shown to the business. */
    transactionId?: string;
    channel?: string;
}

export type FulfillmentOutcome =
    | { status: 'applied' }
    | { status: 'already_applied' }
    | { status: 'rejected'; reason: string };

export type PaymentFulfiller = (input: FulfillmentInput) => Promise<FulfillmentOutcome>;

const fulfillers = new Map<string, PaymentFulfiller>();

export function isReservedFulfillmentKind(kind: string): boolean {
    return (RESERVED_FULFILLMENT_KINDS as readonly string[]).includes(kind);
}

export function registerPaymentFulfiller(kind: string, fulfiller: PaymentFulfiller): void {
    if (isReservedFulfillmentKind(kind)) {
        throw new Error(`Fulfillment kind "${kind}" is reserved and cannot be registered`);
    }
    if (!KIND_PATTERN.test(kind)) {
        throw new Error(`Invalid fulfillment kind "${kind}": use 2-40 chars of a-z, 0-9, _ starting with a letter`);
    }
    if (fulfillers.has(kind)) {
        throw new Error(`A fulfiller is already registered for kind "${kind}"`);
    }
    fulfillers.set(kind, fulfiller);
}

export function getPaymentFulfiller(kind: string): PaymentFulfiller | undefined {
    return fulfillers.get(kind);
}

/** True when `kind` may appear in a payment link (registered and not reserved). */
export function isRegisteredFulfillmentKind(kind: string): boolean {
    return fulfillers.has(kind);
}

export function resetPaymentFulfillersForTests(): void {
    fulfillers.clear();
}

export type FulfillmentMetadata =
    | { state: 'absent' }
    | { state: 'invalid'; reason: string }
    | { state: 'present'; kind: string; entityId: string };

export function parseFulfillmentMetadata(metadata: Record<string, unknown> | null | undefined): FulfillmentMetadata {
    const kind = metadata?.fulfillmentKind;
    if (kind === undefined || kind === null) return { state: 'absent' };
    if (typeof kind !== 'string' || kind.length === 0) {
        return { state: 'invalid', reason: 'fulfillment_kind_invalid' };
    }
    const entityId = metadata?.entityId;
    if (entityId === undefined || entityId === null || entityId === '') {
        return { state: 'invalid', reason: 'fulfillment_entity_missing' };
    }
    if (typeof entityId !== 'string' || entityId.length > MAX_ENTITY_ID_LENGTH) {
        return { state: 'invalid', reason: 'fulfillment_entity_invalid' };
    }
    return { state: 'present', kind, entityId };
}

export interface DispatchArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    reference: string;
    /** Signature-verified webhook metadata. */
    metadata: Record<string, unknown> | null | undefined;
    /** Re-verify with Paystack (only called once a fulfiller is found). */
    verify: () => Promise<VerifyResult>;
    log: FulfillerLogger;
}

export interface DispatchResult {
    /** HTTP 200 body. */
    body: Record<string, unknown>;
    /** Set when money arrived that nothing took responsibility for. */
    unattributedReason?: string;
    amountMinor?: number;
    currency?: string;
}

/**
 * Run the registered fulfiller for a verified charge. Always resolves to a
 * 200-shaped result for expected outcomes; throws only for transient errors
 * (verify or fulfiller failure) so Paystack retries.
 */
export async function dispatchFulfillment(args: DispatchArgs): Promise<DispatchResult> {
    const parsed = parseFulfillmentMetadata(args.metadata);
    if (parsed.state === 'absent') {
        return { body: { ignored: 'no_entity_metadata' }, unattributedReason: 'no_entity_metadata' };
    }
    if (parsed.state === 'invalid') {
        return { body: { ignored: parsed.reason }, unattributedReason: parsed.reason };
    }

    const fulfiller = isReservedFulfillmentKind(parsed.kind) ? undefined : getPaymentFulfiller(parsed.kind);
    if (!fulfiller) {
        return {
            body: { ignored: 'fulfillment_kind_unregistered' },
            unattributedReason: 'fulfillment_kind_unregistered',
        };
    }

    const verified = await args.verify();
    if (verified.status !== 'success') {
        return { body: { ignored: `status_${verified.status}` } };
    }

    // What Paystack stored at initialize time must positively agree with the
    // webhook — kind, entity AND tenant. Missing metadata is a mismatch, not a
    // pass: a tenant holding its own key can sign any webhook, so without this
    // one cheap real charge made with no metadata could be paired with a
    // forged webhook naming a pricier entity.
    const vm = verified.metadata;
    if (
        !vm ||
        vm.fulfillmentKind !== parsed.kind ||
        vm.entityId !== parsed.entityId ||
        vm.tenantId !== args.tenantId
    ) {
        return {
            body: { ignored: 'fulfillment_metadata_mismatch' },
            unattributedReason: 'fulfillment_metadata_mismatch',
            amountMinor: verified.amountKobo,
            currency: verified.currency,
        };
    }

    const outcome = await fulfiller({
        prisma: args.prisma,
        tenantId: args.tenantId,
        entityId: parsed.entityId,
        reference: args.reference,
        amountMinor: verified.amountKobo,
        currency: verified.currency,
        log: args.log,
        transactionId: verified.transactionId,
        channel: verified.channel,
    });

    switch (outcome?.status) {
        case 'applied':
            return { body: { ok: true, entity: parsed.kind } };
        case 'already_applied':
            return { body: { ok: true, idempotent: true } };
        case 'rejected':
            return {
                body: { ignored: 'fulfillment_rejected' },
                unattributedReason: `fulfillment_rejected:${String(outcome.reason).slice(0, 60)}`,
                amountMinor: verified.amountKobo,
                currency: verified.currency,
            };
        default:
            throw new Error(`Fulfiller for "${parsed.kind}" returned an unrecognised outcome`);
    }
}
