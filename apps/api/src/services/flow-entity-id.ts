/**
 * The payment "entity id" for a flow payment: what Paystack stores in the link
 * metadata and hands back on the webhook, naming WHAT was paid for.
 *
 *   <conversationId>.<paymentState>.<amountMinor>.<CCY>
 *
 *  - conversationId + paymentState pin the payment to one step of one
 *    conversation: a link for an earlier step cannot advance a later one.
 *  - amountMinor + CCY are what was asked. The webhook's metadata cross-check
 *    (payment-fulfillers.ts) proves these are the values we put in at
 *    initialisation, so the fulfiller can compare Paystack's reported amount
 *    against them without a row of its own.
 *
 * Pack fulfillers for their own kinds (e.g. 'ride_package') receive the same id
 * and may decode it with decodeFlowEntityId.
 */

export interface FlowEntity {
    conversationId: string;
    state: string;
    amountMinor: number;
    currency: string;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const STATE = /^[a-z][a-z0-9_]{0,39}$/;
const MINOR = /^[0-9]{1,12}$/;
const CCY = /^[A-Z]{3}$/;

/** Keeps the whole id within the 100 character limit the webhook enforces. */
export function encodeFlowEntityId(e: FlowEntity): string {
    return `${e.conversationId}.${e.state}.${e.amountMinor}.${e.currency}`;
}

/** The webhook refuses entity ids longer than this. */
export const MAX_ENTITY_ID_LENGTH = 100;

/**
 * Can this entity be encoded AND decoded back unchanged? Check before creating
 * a payment link: a link whose entity id the fulfiller later rejects would take
 * the customer's money and never advance the flow.
 */
export function canEncodeFlowEntityId(e: FlowEntity): boolean {
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0) return false;
    if (!ID.test(e.conversationId) || !STATE.test(e.state) || !CCY.test(e.currency)) return false;
    if (!MINOR.test(String(e.amountMinor))) return false;
    return encodeFlowEntityId(e).length <= MAX_ENTITY_ID_LENGTH;
}

export function decodeFlowEntityId(id: string | null | undefined): FlowEntity | null {
    const parts = (id ?? '').split('.');
    if (parts.length !== 4) return null;
    const [conversationId, state, minor, currency] = parts;
    if (!ID.test(conversationId) || !STATE.test(state) || !MINOR.test(minor) || !CCY.test(currency)) return null;
    const amountMinor = Number(minor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
    return { conversationId, state, amountMinor, currency };
}
