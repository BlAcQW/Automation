/**
 * publishEvent: record a DomainEvent and fan it out to the tenant's matching
 * webhook subscriptions (one PENDING WebhookDelivery each).
 *
 * Transactions: pass a Prisma transaction client to make the event atomic with
 * the business change (the event exists iff the change committed). Called with
 * a plain client, the event + deliveries are written in one transaction here.
 *
 * Nudging: after the rows are written we ask the worker to deliver. With a plain
 * client that is immediate. With a transaction client we cannot observe the
 * commit, so the nudge is delayed (TX_NUDGE_DELAY_MS) so it fires after a normal
 * commit; if it fires first the claim finds nothing and skips, and the sweeper
 * (every 30s) delivers it. Either way delivery is at-least-once, never lost.
 *
 * Throws on database errors (inside a transaction the caller's tx is doomed
 * anyway); the nudge itself never throws.
 */
import { nudgeDeliveries } from './dispatcher.js';
import { TEST_EVENT_TYPE, WILDCARD_EVENT, isFanOutOnlyType } from './catalogue.js';

export const TX_NUDGE_DELAY_MS = 2_000;
export const BILLING_UNIT_CACHE_TTL_MS = 30_000;
const BILLING_UNIT_CACHE_MAX = 5_000;

const TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface PublishInput {
    tenantId: string;
    type: string;
    payload: Record<string, unknown>;
    /**
     * Idempotency key, unique per tenant (DomainEvent @@unique([tenantId,
     * dedupeKey])). A second insert with the same key fails with Prisma P2002,
     * which publishEventOnce reports as "duplicate". Inside a caller-supplied
     * transaction that failure aborts the transaction, so only pass this with a
     * plain client (publishEventOnce does).
     */
    dedupeKey?: string;
    /**
     * Fan-out only: when the tenant has no active subscription matching `type`
     * (including the managed external-app one) write NOTHING (no DomainEvent
     * row, no payload retained) and return eventId null. For high-volume
     * events whose only purpose is delivery.
     */
    storeOnlyIfSubscribed?: boolean;
}

/**
 * Billing units are always stored. A tenant whose BillingTerms.unitEventType
 * is `type` is charged by counting DomainEvent rows of that type, so the
 * "skip the row when nobody subscribes" optimisation must not apply to it
 * (the count would be silently zero). Only consulted on the skip path, so the
 * common case costs nothing. Cached per tenant for BILLING_UNIT_CACHE_TTL_MS
 * (the admin route clears the entry of the process that edited the terms; other
 * processes converge within the TTL, and an event published in that window for
 * a freshly-set unit type can be missed: set terms before traffic starts).
 * FAILS SAFE: if the lookup throws, store the event (and do not cache that).
 * Note that inside a caller's Postgres transaction a failed query dooms the
 * transaction; the lookup is a primary-key-style read and the same exposure as
 * the subscription query above it.
 */
const billingUnitCache = new Map<string, { unit: string | null; expiresAt: number }>();

export function clearBillingUnitCache(tenantId?: string): void {
    if (tenantId) billingUnitCache.delete(tenantId);
    else billingUnitCache.clear();
}

async function isBillingUnitType(tx: any, tenantId: string, type: string): Promise<boolean> {
    const now = Date.now();
    const hit = billingUnitCache.get(tenantId);
    if (hit && hit.expiresAt > now) return hit.unit === type;
    try {
        const row = await tx.billingTerms.findUnique({ where: { tenantId }, select: { unitEventType: true } });
        const unit: string | null = row?.unitEventType ?? null;
        if (billingUnitCache.size >= BILLING_UNIT_CACHE_MAX) billingUnitCache.clear();
        billingUnitCache.set(tenantId, { unit, expiresAt: now + BILLING_UNIT_CACHE_TTL_MS });
        return unit === type;
    } catch {
        return true;
    }
}

function isTransactionClient(prisma: any): boolean {
    return typeof prisma.$transaction !== 'function';
}

async function write(
    tx: any,
    input: PublishInput,
    subscriptionIds: 'match' | string[],
): Promise<{ eventId: string | null; deliveryIds: string[] }> {
    const subs: Array<{ id: string }> =
        subscriptionIds === 'match'
            ? await tx.webhookSubscription.findMany({
                  where: {
                      tenantId: input.tenantId,
                      isActive: true,
                      OR: [{ events: { has: input.type } }, { events: { has: WILDCARD_EVENT } }],
                  },
                  select: { id: true },
              })
            : subscriptionIds.map((id) => ({ id }));

    const fanOutOnly = input.storeOnlyIfSubscribed ?? isFanOutOnlyType(input.type);
    if (fanOutOnly && subs.length === 0 && !(await isBillingUnitType(tx, input.tenantId, input.type))) {
        return { eventId: null, deliveryIds: [] };
    }

    const event = await tx.domainEvent.create({
        data: {
            tenantId: input.tenantId,
            type: input.type,
            payload: input.payload as object,
            ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        },
        select: { id: true },
    });
    const deliveryIds: string[] = [];
    for (const sub of subs) {
        const d = await tx.webhookDelivery.create({
            data: { tenantId: input.tenantId, subscriptionId: sub.id, eventId: event.id, status: 'PENDING' },
            select: { id: true },
        });
        deliveryIds.push(d.id);
    }
    return { eventId: event.id as string, deliveryIds };
}

function validate(input: PublishInput, allowTest = false): void {
    if (!input.tenantId) throw new Error('publishEvent: tenantId is required');
    if (!allowTest && !TYPE_RE.test(input.type ?? '')) throw new Error(`publishEvent: invalid event type "${input.type}"`);
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
        throw new Error('publishEvent: payload must be an object');
    }
}

async function run(prisma: any, input: PublishInput, subs: 'match' | string[]): Promise<{ eventId: string | null }> {
    const inTx = isTransactionClient(prisma);
    const result = inTx
        ? await write(prisma, input, subs)
        : await prisma.$transaction((tx: any) => write(tx, input, subs));
    if (result.deliveryIds.length > 0) {
        await nudgeDeliveries(result.deliveryIds, inTx ? TX_NUDGE_DELAY_MS : 0);
    }
    return { eventId: result.eventId };
}

/** eventId is null only when `storeOnlyIfSubscribed` skipped the write. */
export async function publishEvent(prisma: any, input: PublishInput): Promise<{ eventId: string | null }> {
    validate(input);
    return run(prisma, input, 'match');
}

/** A `webhook.test` event for ONE subscription, regardless of its event filter. */
export async function publishTestEvent(
    prisma: any,
    args: { tenantId: string; subscriptionId: string },
): Promise<{ eventId: string }> {
    const input = {
        tenantId: args.tenantId,
        type: TEST_EVENT_TYPE,
        payload: { v: 1, message: 'This is a test event from Bookly.' },
    };
    validate(input, true);
    const { eventId } = await run(prisma, input, [args.subscriptionId]);
    return { eventId: eventId as string }; // never null: storeOnlyIfSubscribed is not set
}
