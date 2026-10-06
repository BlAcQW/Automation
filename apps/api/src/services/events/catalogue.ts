/**
 * Domain event catalogue (D3).
 *
 * Every event is delivered to subscribers as
 *   { id, type, tenantId, createdAt, data: <payload> }
 * and every payload carries `v` (the payload schema version, currently 1).
 * Additive changes keep `v`; a breaking change to a payload bumps `v` and the
 * old version is published alongside it for a deprecation window.
 *
 * `fields` documents the payload keys for receivers (the developer docs read it).
 * publishEvent does not reject types missing from here (a typo in a producer
 * must not break the business path that is publishing); the subscription
 * routes DO only accept catalogue types (or '*').
 */

export interface EventTypeDoc {
    description: string;
    /** Payload schema version. */
    v: 1;
    /** Payload keys (besides `v`) and what they hold. */
    fields: Readonly<Record<string, string>>;
}

const doc = (description: string, fields: Record<string, string>): EventTypeDoc => ({
    description,
    v: 1,
    fields: Object.freeze({ v: 'number, always 1', ...fields }),
});

export const EVENT_TYPES = Object.freeze({
    'message.received': doc('A customer message arrived', {
        conversationId: 'string', messageId: 'string', channel: "'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER'",
        customerId: 'string | null',
        text: 'string (the message text; the caption, reply id or place name for other types; "" when there is none)',
        type: "'TEXT' | 'INTERACTIVE' | 'LOCATION' | 'CONTACT' | 'REACTION' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'STICKER' | 'DOCUMENT' (the media type for attachments)",
    }),
    'message.sent': doc('A reply was sent to a customer', {
        conversationId: 'string', messageId: 'string', channel: 'string', sentBy: "'AI' | 'HUMAN' | 'FLOW' | 'APP'",
    }),
    'conversation.handoff': doc('A conversation was handed to a person or an external app', {
        conversationId: 'string', to: "'HUMAN' | 'APP'", reason: 'string | null',
    }),
    'conversation.resumed': doc('A conversation went back to the assistant', { conversationId: 'string' }),
    'customer.created': doc('A customer record was created', { customerId: 'string' }),
    'customer.updated': doc('A customer record changed', { customerId: 'string', changed: 'string[] (field names)' }),
    'payment.succeeded': doc('A payment was confirmed', {
        paymentId: 'string', amount: 'number (minor units)', currency: 'string', reference: 'string',
        bookingId: 'string (booking charges only)', orderId: 'string (order charges only)',
        conversationId: 'string (flow payments only)', entityRef: 'string (flow and external-app payments only)',
    }),
    'payment.failed': doc('A payment failed or was abandoned', {
        paymentId: 'string', amount: 'number (minor units)', currency: 'string', reference: 'string',
        reason: "string (e.g. 'underpaid')", bookingId: 'string (booking charges only)', orderId: 'string (order charges only)',
    }),
    'booking.created': doc('A booking was created', { bookingId: 'string', customerId: 'string | null', startsAt: 'ISO date' }),
    'booking.cancelled': doc('A booking was cancelled', { bookingId: 'string', reason: 'string | null' }),
    'booking.completed': doc('A booking was completed', { bookingId: 'string' }),
    'order.created': doc('An order was created', { orderId: 'string', customerId: 'string | null', total: 'number (minor units)', currency: 'string' }),
    'flow.completed': doc('A conversation flow reached its end', {
        flowKey: 'string (the flow definition key)', version: 'number (the definition version that ran)',
        conversationId: 'string', customerId: 'string | null',
        vars: 'object (values the flow collected, from an allowlist derived from the definition: menu set values, choose value/label/attrs, declared produces; never free-text ask answers, locations, payment url/reference or phone)',
    }),
    'ride.requested': doc('A ride was requested (a package ride booked, or a PAYG ride paid)', {
        rideId: 'string', ref: 'string (customer-facing, e.g. TR-7K2Q9M)', kind: "'PACKAGE' | 'PAYG'", customerId: 'string',
        distanceKm: 'number (estimated road distance)', fare: 'number (minor units; 0 for package rides)', currency: 'string',
        source: "'WHATSAPP' | 'APP' | 'CONSOLE'",
    }),
    'ride.assigned': doc('A driver was assigned to a ride', {
        rideId: 'string', ref: 'string', kind: "'PACKAGE' | 'PAYG'", customerId: 'string', driverId: 'string',
    }),
    'ride.completed': doc('A ride was marked completed (a package ride deducts one ride here, once)', {
        rideId: 'string', ref: 'string', kind: "'PACKAGE' | 'PAYG'", customerId: 'string', passId: 'string | null',
        ridesRemaining: 'number | null (package balance after this ride; null for PAYG)',
    }),
    'ride_pass.activated': doc('A ride package was activated by a verified payment', {
        passId: 'string', customerId: 'string', rides: 'number', expiresAt: 'ISO date', reference: 'string (payment reference)',
    }),
} as const satisfies Record<string, EventTypeDoc>);

export type EventType = keyof typeof EVENT_TYPES;
export const EVENT_TYPE_NAMES = Object.freeze(Object.keys(EVENT_TYPES)) as readonly EventType[];
export const WILDCARD_EVENT = '*';
/** Sent only by the "send a test event" route; not subscribable. */
export const TEST_EVENT_TYPE = 'webhook.test';

export function isEventType(value: string): value is EventType {
    return Object.prototype.hasOwnProperty.call(EVENT_TYPES, value);
}

/**
 * High-volume events that exist only to be delivered. Producers publish these
 * with `storeOnlyIfSubscribed`: when the tenant has no matching subscription no
 * DomainEvent row (and so no retained customer text / contact data) is written.
 * Money events (payment.*) and flow.completed are rare and double as
 * idempotency / audit records, so they are always stored.
 */
const FAN_OUT_ONLY_TYPES: ReadonlySet<string> = new Set([
    'message.received', 'message.sent',
    'customer.created', 'customer.updated',
    'booking.created', 'booking.cancelled', 'booking.completed',
    'order.created',
    'conversation.handoff', 'conversation.resumed',
]);

export function isFanOutOnlyType(type: string): boolean {
    return FAN_OUT_ONLY_TYPES.has(type);
}
