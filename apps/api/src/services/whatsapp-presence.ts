/**
 * Read receipts and typing indicators.
 *
 * Both are sent to the same /messages endpoint as a normal send, but they are
 * not messages: Meta does not bill for them, and they produce no Message row.
 * What they buy is the thing that makes a bot feel staffed — the customer sees
 * their message turn blue and "typing…" appear while the bot works, instead of
 * silence followed by an instant reply.
 *
 * Entirely best-effort. A failure here must never affect whether the customer
 * actually gets an answer, so nothing throws.
 */

import type { FastifyBaseLogger } from 'fastify';

interface PresenceArgs {
    phoneNumberId: string;
    accessToken: string;
    /** The INBOUND message being acknowledged — required by Meta. */
    messageId: string;
    logger?: FastifyBaseLogger;
}

async function post(args: PresenceArgs, body: Record<string, unknown>): Promise<void> {
    try {
        const response = await fetch(
            `https://graph.facebook.com/v21.0/${args.phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${args.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
            },
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            args.logger?.debug({ status: response.status, error }, 'Presence update rejected');
        }
    } catch (err) {
        args.logger?.debug({ err }, 'Presence update failed');
    }
}

/** Blue ticks on the customer's message. */
export async function markRead(args: PresenceArgs): Promise<void> {
    await post(args, { status: 'read', message_id: args.messageId });
}

/**
 * Blue ticks AND "typing…" in one call.
 *
 * The indicator clears when the next message is sent, or after ~25 seconds —
 * so only call this immediately before work that actually produces a reply,
 * otherwise the customer watches a typing bubble that never resolves.
 */
export async function markReadAndTyping(args: PresenceArgs): Promise<void> {
    await post(args, {
        status: 'read',
        message_id: args.messageId,
        typing_indicator: { type: 'text' },
    });
}
