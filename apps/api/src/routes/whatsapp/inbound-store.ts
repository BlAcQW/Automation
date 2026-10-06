/**
 * Store-or-reuse for inbound messages, with a "handled" marker.
 *
 * The inbound Message row is inserted BEFORE the turn runs (so the chat shows
 * it immediately and a concurrent redelivery dedupes). That alone is not a
 * safe idempotency key: if the turn then throws, the retry would find the row,
 * conclude "already done" and the customer would never be answered.
 *
 * So the row carries `handledAt`, set only when the turn completed normally
 * (including deliberate no-reply outcomes: human takeover, fallback, quota).
 *   - existing row, handledAt set  -> true duplicate, skip.
 *   - existing row, handledAt null -> an earlier attempt died mid-turn: reuse
 *     the row (never insert twice) and run the turn again.
 *
 * Known trade-off: a crash AFTER the reply was sent but BEFORE markInboundHandled
 * runs yields one duplicate reply on retry. That is preferred over a lost one.
 */

import { isDuplicateMessageError } from '../../services/assistant-fallback.js';

export interface InboundSlot {
    /** Id of the stored inbound Message row (undefined only if the store returned none). */
    id: string | undefined;
    /** True when a previous attempt already completed the turn: do nothing. */
    handled: boolean;
}

/** Look up an already-stored inbound row by provider id. Null when none / no id. */
export async function findInbound(
    prisma: any,
    conversationId: string,
    providerMessageId: string | null | undefined,
): Promise<InboundSlot | null> {
    if (!providerMessageId) return null;
    const row = await prisma.message.findFirst({
        where: { conversationId, whatsappMsgId: providerMessageId },
        select: { id: true, handledAt: true },
    });
    return row ? { id: row.id, handled: Boolean(row.handledAt) } : null;
}

/**
 * Insert the inbound row. If a concurrent delivery won the insert race (P2002),
 * re-read the winner and report its handled state instead of dropping the turn.
 */
export async function insertInbound(
    prisma: any,
    conversationId: string,
    providerMessageId: string | null | undefined,
    data: Record<string, unknown>,
): Promise<InboundSlot> {
    try {
        const row = await prisma.message.create({ data });
        return { id: row?.id, handled: false };
    } catch (err) {
        if (isDuplicateMessageError(err)) {
            const existing = await findInbound(prisma, conversationId, providerMessageId);
            if (existing) return existing;
        }
        throw err;
    }
}

/** Mark the turn complete. Idempotent; keeps the first timestamp. */
export async function markInboundHandled(prisma: any, id: string | undefined): Promise<void> {
    if (!id) return;
    await prisma.message.updateMany({ where: { id, handledAt: null }, data: { handledAt: new Date() } });
}
