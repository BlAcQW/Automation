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
 *
 * PAYAZA. A tenant whose provider is Payaza gets a Payaza payment page for the
 * same kinds, with the same reference (`bf_f_{kind}_{entityId}_{ts}`). Payaza
 * echoes no metadata, so its webhook (routes/payments/payaza.ts) derives kind
 * and entity from OUR reference, finds the tenant from the stored row through
 * the owner resolver registered for the kind (registerFulfillmentOwner), and
 * passes `trustedMetadata`. `input.provider` tells a fulfiller which gateway
 * took the money (for the record, and refund wording).
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

export type PaymentProviderName = 'PAYSTACK' | 'PAYAZA';

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
    /** Which gateway took the money. Absent = unknown (older callers). */
    provider?: PaymentProviderName;
}

export type FulfillmentOutcome =
    | { status: 'applied' }
    | { status: 'already_applied' }
    | { status: 'rejected'; reason: string };

export type PaymentFulfiller = (input: FulfillmentInput) => Promise<FulfillmentOutcome>;

const fulfillers = new Map<string, PaymentFulfiller>();

/**
 * Which tenant owns an entity of a kind, read from OUR row (never from a
 * provider payload). Needed by providers whose webhook carries no trustworthy
 * tenant id before the signature is checked (Payaza): the tenant chosen here
 * decides which secret verifies the signature.
 */
export type FulfillmentOwnerResolver = (prisma: ExtendedPrismaClient, entityId: string) => Promise<string | null>;
const owners = new Map<string, FulfillmentOwnerResolver>();

export function registerFulfillmentOwner(kind: string, resolver: FulfillmentOwnerResolver): void {
    if (owners.has(kind)) throw new Error(`An owner resolver is already registered for kind "${kind}"`);
    owners.set(kind, resolver);
}

export function hasFulfillmentOwner(kind: string): boolean {
    return owners.has(kind);
}

export async function resolveFulfillmentTenant(prisma: ExtendedPrismaClient, kind: string, entityId: string): Promise<string | null> {
    const resolver = owners.get(kind);
    return resolver ? resolver(prisma, entityId) : null;
}

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
    // References are bf_f_{kind}_{entityId}_{ts} and parsed back by kind (parseFulfillmentReference):
    // kinds 'a' and 'a_b' would make 'bf_f_a_b_x_1' mean two things.
    const clash = [...fulfillers.keys()].find((k) => kind.startsWith(`${k}_`) || k.startsWith(`${kind}_`));
    if (clash) {
        throw new Error(`Fulfillment kind "${kind}" would make references ambiguous with "${clash}"`);
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
    owners.clear();
}

// ------------------------------------------------------------ references

const REFERENCE_PREFIX = 'bf_f_';
const REFERENCE_TAIL = /_([0-9]{1,16})$/;

/** `bf_f_{kind}_{entityId}_{ts}`: f = fulfillment, distinct from order (bf_o_) references. */
export function buildFulfillmentReference(kind: string, entityId: string, now: number = Date.now()): string {
    return `${REFERENCE_PREFIX}${kind}_${entityId}_${now}`;
}

/**
 * Kind + entity id back out of one of our fulfillment references. Both may
 * contain underscores, so the kind is matched against the REGISTERED kinds
 * (longest first) rather than split on a separator. Null for anything that is
 * not ours (another product on the same gateway account, a malformed value).
 */
export function parseFulfillmentReference(reference: string): { kind: string; entityId: string } | null {
    if (!reference.startsWith(REFERENCE_PREFIX)) return null;
    const tail = REFERENCE_TAIL.exec(reference);
    if (!tail) return null;
    const middle = reference.slice(REFERENCE_PREFIX.length, reference.length - tail[0].length);
    const kinds = [...fulfillers.keys()].sort((a, b) => b.length - a.length);
    for (const kind of kinds) {
        if (!middle.startsWith(`${kind}_`)) continue;
        const entityId = middle.slice(kind.length + 1);
        if (entityId.length === 0 || entityId.length > MAX_ENTITY_ID_LENGTH) return null;
        return { kind, entityId };
    }
    return null;
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
    /**
     * For providers that do not echo metadata on their verify call (Payaza):
     * the kind / entity / tenant derived from OUR reference and stored row,
     * never from the webhook body. Used for the cross-check only when the
     * provider returned no metadata, and only if the provider's answer is about
     * this very reference (the query was keyed on it).
     *
     * WEAKER THAN PAYSTACK'S CHECK. With Payaza the reference itself rides on a
     * customer-visible page URL, and anyone holding the (public) key can start a
     * payment for any reference. So for Payaza this check only proves the kind
     * and entity named by the reference; it does NOT prove we issued them. A
     * fulfiller must therefore compare the amount with a stored row or stored
     * state, never with anything encoded in the entity id. Rides check their
     * row; flow_payment is protected because the flow engine re-checks the
     * reference and amount against the conversation's CURRENT step
     * (flows/engine.ts eventIsForThisPayment); a forged cheap reference only
     * reaches the unmatched-money alert.
     */
    trustedMetadata?: Record<string, unknown>;
    /** Which gateway took the money; handed to the fulfiller. */
    provider?: PaymentProviderName;
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
    const vm = verified.metadata ?? (args.trustedMetadata && verified.reference === args.reference ? args.trustedMetadata : null);
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
        ...(args.provider ? { provider: args.provider } : {}),
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
