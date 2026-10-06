/**
 * Producers' side of the domain events (catalogue.ts).
 *
 * BEST-EFFORT BY DEFAULT. An event describes something that already happened.
 * A failed publish must never turn a successful booking, payment or reply into
 * an error (the caller would retry and repeat the business action), so every
 * helper here catches and logs. publishEvent itself still throws loudly; the
 * "never silent" half of that contract is the warn log below.
 *
 * AFTER COMMIT, NOT INSIDE THE TRANSACTION. publishEvent accepts a transaction
 * client, but a failed INSERT aborts the whole Postgres transaction, so a
 * "best-effort" publish inside one cannot exist: the failure would doom the
 * business write. Where a transaction exists (booking, order) we publish right
 * after it commits. The cost is a crash in that gap loses the event; the cost
 * of the alternative is a failed booking because the event log had a blip.
 *
 * Two flavours exist where best-effort is wrong or not enough:
 *  - strict (emitMessageReceived({ strict: true })): delivery to an external
 *    app IS the event, so a failure must fail the turn and be retried.
 *  - once (publishEventOnce): exactly one event per key under concurrency and
 *    redelivery (payments, retried inbound turns).
 */

import { scoped } from '../../lib/logger.js';
import { publishEvent } from './publish.js';

const defaultLog = scoped('events');

export interface EmitLogger {
    warn: (obj: object, msg?: string) => void;
}

interface EventInput {
    tenantId: string;
    type: string;
    payload: Record<string, unknown>;
    /**
     * Skip the DomainEvent row when no active subscription matches. Defaults
     * from the type in publishEvent (catalogue isFanOutOnlyType); pass false to
     * force storage, true to force skipping.
     */
    storeOnlyIfSubscribed?: boolean;
}

/** v is always 1 here and cannot be overridden by a payload. */
function versioned(input: EventInput): EventInput {
    return { ...input, payload: { ...input.payload, v: 1 } };
}

/** Publish and swallow failures. Returns whether the event was written. */
export async function publishEventSafe(
    prisma: unknown,
    input: EventInput,
    log: EmitLogger = defaultLog,
): Promise<boolean> {
    try {
        await publishEvent(prisma, versioned(input));
        return true;
    } catch (err) {
        log.warn({ err, type: input.type, tenantId: input.tenantId }, 'Event publish failed; the business action is unaffected');
        return false;
    }
}

/**
 * Publish at most once per (tenant, type, dedupe value).
 *
 * Atomic via DomainEvent @@unique([tenantId, dedupeKey]): the key is
 * `${type}:${field}:${value}` and a second insert fails with P2002, reported as
 * 'duplicate'. Concurrent callers need no advisory lock: the second INSERT waits
 * on the unique index until the first transaction ends, then fails (or, if the
 * first rolled back, succeeds). There is no JSON payload scan. Pass a plain
 * client, not a transaction: a P2002 inside a caller's transaction would abort
 * it.
 *
 * Idempotency records are stored even with no subscriber (payment.*), but a
 * type that defaults to fan-out only (message.received) writes nothing when
 * nobody subscribes and reports 'skipped': with no subscriber there is nothing
 * to deliver twice, and retaining the text just to dedupe it is not worth it.
 * Throws on other failures.
 */
export async function publishEventOnce(
    prisma: any,
    input: EventInput,
    dedupe: { field: string; equals: string },
): Promise<'published' | 'duplicate' | 'skipped'> {
    const dedupeKey = `${input.type}:${dedupe.field}:${dedupe.equals}`;
    try {
        const { eventId } = await publishEvent(prisma, { ...versioned(input), dedupeKey });
        return eventId === null ? 'skipped' : 'published';
    } catch (err) {
        if ((err as { code?: string } | null)?.code === 'P2002') return 'duplicate';
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Conversations and messages

export interface MessageReceivedArgs {
    tenantId: string;
    conversationId: string;
    /** The stored inbound Message row id. */
    messageId: string;
    channel: 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';
    customerId?: string | null;
    /** The text, or the caption / reply id / place name for non-text messages. */
    text?: string;
    /** Stored message type: TEXT, INTERACTIVE, LOCATION, CONTACT, REACTION, IMAGE, VIDEO, AUDIO, STICKER, DOCUMENT. */
    type: string;
    /** Fail (throw) when the event cannot be written. For external-app delivery. */
    strict?: boolean;
    /** Skip when this inbound message already produced the event (retried turn). */
    once?: boolean;
}

export async function emitMessageReceived(prisma: any, args: MessageReceivedArgs): Promise<void> {
    const input: EventInput = {
        tenantId: args.tenantId,
        type: 'message.received',
        payload: {
            conversationId: args.conversationId,
            messageId: args.messageId,
            channel: args.channel,
            customerId: args.customerId ?? null,
            text: args.text ?? '',
            type: args.type,
        },
    };
    const run = async () => {
        if (args.once) await publishEventOnce(prisma, input, { field: 'messageId', equals: args.messageId });
        else await publishEvent(prisma, versioned(input));
    };
    if (args.strict) return run();
    try {
        await run();
    } catch (err) {
        defaultLog.warn({ err, type: input.type, tenantId: args.tenantId }, 'Event publish failed; the business action is unaffected');
    }
}

export type SentBy = 'AI' | 'HUMAN' | 'FLOW' | 'APP';

export async function emitMessageSent(
    prisma: unknown,
    args: { tenantId: string; conversationId: string; messageId: string; channel: string; sentBy: SentBy },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'message.sent',
        payload: { conversationId: args.conversationId, messageId: args.messageId, channel: args.channel, sentBy: args.sentBy },
    });
}

export async function emitConversationHandoff(
    prisma: unknown,
    args: { tenantId: string; conversationId: string; to?: 'HUMAN' | 'APP'; reason?: string | null },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'conversation.handoff',
        payload: { conversationId: args.conversationId, to: args.to ?? 'HUMAN', reason: args.reason ?? null },
    });
}

export async function emitConversationResumed(
    prisma: unknown,
    args: { tenantId: string; conversationId: string },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'conversation.resumed',
        payload: { conversationId: args.conversationId },
    });
}

// ---------------------------------------------------------------------------
// Bookings and orders

export async function emitBookingCreated(
    prisma: unknown,
    args: { tenantId: string; bookingId: string; customerId: string | null; startsAt: Date },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'booking.created',
        payload: { bookingId: args.bookingId, customerId: args.customerId, startsAt: args.startsAt.toISOString() },
    });
}

export async function emitBookingCancelled(
    prisma: unknown,
    args: { tenantId: string; bookingId: string; reason: string | null },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'booking.cancelled',
        payload: { bookingId: args.bookingId, reason: args.reason },
    });
}

export async function emitBookingCompleted(
    prisma: unknown,
    args: { tenantId: string; bookingId: string },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'booking.completed',
        payload: { bookingId: args.bookingId },
    });
}

export async function emitOrderCreated(
    prisma: unknown,
    args: { tenantId: string; orderId: string; customerId: string | null; /** Major units. */ total: number; currency: string },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'order.created',
        payload: {
            orderId: args.orderId,
            customerId: args.customerId,
            total: Math.round(args.total * 100),
            currency: args.currency,
        },
    });
}

// ---------------------------------------------------------------------------
// Payments

interface PaymentArgs {
    tenantId: string;
    reference: string;
    amountMinor: number;
    currency: string;
    /** Additive context (bookingId, orderId, ...). Cannot override the catalogue keys. */
    extra?: Record<string, unknown>;
}

function paymentPayload(args: PaymentArgs): Record<string, unknown> {
    return {
        ...(args.extra ?? {}),
        paymentId: args.reference,
        amount: args.amountMinor,
        currency: args.currency,
        reference: args.reference,
    };
}

export async function emitPaymentSucceeded(prisma: unknown, args: PaymentArgs): Promise<void> {
    await publishEventSafe(prisma, { tenantId: args.tenantId, type: 'payment.succeeded', payload: paymentPayload(args) });
}

/**
 * Once per reference: an underpaid charge is redelivered with no claim to stop
 * it (nothing was flipped), so the event must dedupe itself.
 */
export async function emitPaymentFailed(prisma: any, args: PaymentArgs & { reason: string }): Promise<void> {
    const input: EventInput = {
        tenantId: args.tenantId,
        type: 'payment.failed',
        payload: { ...paymentPayload(args), reason: args.reason },
    };
    try {
        await publishEventOnce(prisma, input, { field: 'reference', equals: args.reference });
    } catch (err) {
        defaultLog.warn({ err, type: input.type, tenantId: args.tenantId }, 'Event publish failed; the business action is unaffected');
    }
}
