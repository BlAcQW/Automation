/**
 * Which orders / bookings were created in THIS conversation.
 *
 * Why this exists: on WhatsApp the sender's phone is verified by Meta, so it can
 * scope order/booking lookups. On Instagram and Messenger there is no phone;
 * the customer TYPES one, and an asserted phone proves nothing. Scoping lookups
 * to it would let anyone read a stranger's orders (and pay links) by claiming
 * their number. So on those channels the assistant may only show what this very
 * conversation created, which is recorded here.
 *
 * Stored in Conversation.botContext.chatOwned = { orders: [...], bookings: [...] }
 * (no schema change). Writes use the same contextVersion optimistic lock as the
 * flow runner and preserve every other botContext key.
 */

import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export type OwnedKind = 'orders' | 'bookings';

/** A chat is a handful of orders; the cap keeps botContext small. Newest kept. */
const MAX_OWNED = 50;
const CLAIM_ATTEMPTS = 4;

function asRecord(v: unknown): Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function idsOf(botContext: unknown, kind: OwnedKind): string[] {
    const list = asRecord(asRecord(botContext).chatOwned)[kind];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

export async function ownedIds(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    conversationId: string,
    kind: OwnedKind,
): Promise<string[]> {
    const row = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { botContext: true },
    });
    return row ? idsOf(row.botContext, kind) : [];
}

/**
 * Best-effort: never throws. If it cannot record, the entity still exists and
 * the customer simply cannot look it up in chat (fails closed, staff can help).
 */
export async function rememberOwned(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    conversationId: string,
    kind: OwnedKind,
    id: string,
): Promise<void> {
    try {
        for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
            const row = await prisma.conversation.findFirst({
                where: { id: conversationId, tenantId },
                select: { botContext: true, contextVersion: true },
            });
            if (!row) return;
            const current = idsOf(row.botContext, kind);
            const next = current.includes(id) ? current : [...current, id].slice(-MAX_OWNED);
            const base = asRecord(row.botContext);
            const owned = asRecord(base.chatOwned);
            const botContext = { ...base, chatOwned: { ...owned, [kind]: next } };
            const { count } = await prisma.conversation.updateMany({
                where: { id: conversationId, tenantId, contextVersion: row.contextVersion },
                data: { botContext: botContext as object, contextVersion: { increment: 1 } },
            });
            if (count === 1) return;
        }
    } catch {
        // see above: fail closed, not loud
    }
}
