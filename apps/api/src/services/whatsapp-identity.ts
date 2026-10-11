/**
 * Who a WhatsApp customer is, and how to address them.
 *
 * Until 2026 every WhatsApp sender was a phone number (`messages[].from`).
 * With WhatsApp usernames, a person can hide their number: Meta then sends
 * only a business-scoped user id (BSUID, `messages[].from_user_id`, shaped like
 * `GH.1234567890123456`) and replies must go to it as `recipient`, not `to`.
 *
 * A conversation's `externalId` is whichever of the two we were given, so it
 * is also the reply address. A BSUID is never a phone: a number the customer
 * types later is unverified and must not be treated like `from`.
 */

const PHONE_ID = /^\+?\d{6,15}$/;

/** True for a phone-number identity, false for a BSUID (or anything else). */
export function isWhatsAppPhoneId(id: string | null | undefined): boolean {
    return typeof id === 'string' && PHONE_ID.test(id);
}

/** The Cloud API addressing fields for a conversation's `externalId`. */
export function whatsappDestination(id: string): { to: string } | { recipient: string } {
    return isWhatsAppPhoneId(id) ? { to: id } : { recipient: id };
}

interface InboundSender {
    from?: string;
    from_user_id?: string;
}

/**
 * The sender's identity on an inbound message: the phone when Meta shares it,
 * else the BSUID. Null when Meta sent neither (nothing we can reply to).
 */
export function inboundSenderId(message: InboundSender): string | null {
    return message.from || message.from_user_id || null;
}

/** The sender's Meta-verified phone, or null for a username-only sender. */
export function inboundSenderPhone(message: InboundSender): string | null {
    return message.from && isWhatsAppPhoneId(message.from) ? message.from : null;
}
