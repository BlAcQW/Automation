/**
 * Finding or creating the conversation an inbound message belongs to.
 *
 * Conversations used to be keyed on phone number, which only WhatsApp has.
 * Instagram and Messenger identify people by an opaque scoped id (IGSID/PSID),
 * so identity is now `(tenantId, channel, externalId)` and the phone is display
 * data that may be absent.
 *
 * This lives in one place on purpose. The previous find-or-create was inlined
 * in the WhatsApp webhook and referenced the old composite key directly; when
 * that key changed, TypeScript did not catch it because the Prisma client is
 * widened by the tenant-guard extension. A single tested helper is the thing
 * that stops the same trap being set again for two more channels.
 */

import type { ConversationChannel, PrismaClient } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export type AnyPrismaClient = PrismaClient | ExtendedPrismaClient;

export interface ResolveConversationArgs {
    tenantId: string;
    channel: ConversationChannel;
    /** Phone (WhatsApp) or scoped id (IGSID / PSID). Identity on this channel. */
    externalId: string;
    /** WhatsApp only. Null elsewhere until the bot asks for it. */
    customerPhone?: string | null;
    /** Instagram @username, for display. */
    customerHandle?: string | null;
    customerName?: string | null;
}

export interface ResolvedConversation {
    id: string;
    state: string;
    customerName: string | null;
    /**
     * Known number, or null on Instagram/Messenger until the customer gives
     * one. The agent needs it to decide whether it still has to ask.
     */
    customerPhone: string | null;
    /** Bot flow state — the message handler reads and advances this. */
    botContext: unknown;
    botFailureCount: number;
    created: boolean;
}

/**
 * Get the conversation for this (tenant, channel, sender), creating it on first
 * contact.
 *
 * Late-arriving details — a profile name, or an Instagram handle that changed —
 * are filled in but never overwritten with nothing, so a later webhook that
 * omits the name cannot blank one we already have.
 */
export async function resolveConversation(
    prisma: AnyPrismaClient,
    args: ResolveConversationArgs,
): Promise<ResolvedConversation> {
    const existing = await prisma.conversation.findUnique({
        where: {
            tenantId_channel_externalId: {
                tenantId: args.tenantId,
                channel: args.channel,
                externalId: args.externalId,
            },
        },
        select: {
            id: true,
            state: true,
            customerName: true,
            customerHandle: true,
            customerPhone: true,
            botContext: true,
            botFailureCount: true,
        },
    });

    if (!existing) {
        const created = await prisma.conversation.create({
            data: {
                tenantId: args.tenantId,
                channel: args.channel,
                externalId: args.externalId,
                customerPhone: args.customerPhone ?? null,
                customerHandle: args.customerHandle ?? null,
                customerName: args.customerName ?? null,
                state: 'BOT_ACTIVE',
            },
            select: {
                id: true,
                state: true,
                customerName: true,
                customerPhone: true,
                botContext: true,
                botFailureCount: true,
            },
        });
        return { ...created, created: true };
    }

    // Backfill only what is missing. A webhook without a profile name must not
    // erase one an earlier webhook gave us.
    const patch: Record<string, string> = {};
    if (args.customerName && !existing.customerName) patch.customerName = args.customerName;
    if (args.customerHandle && !existing.customerHandle) patch.customerHandle = args.customerHandle;
    if (args.customerPhone && !existing.customerPhone) patch.customerPhone = args.customerPhone;

    if (Object.keys(patch).length > 0) {
        await prisma.conversation.update({ where: { id: existing.id }, data: patch });
    }

    return {
        id: existing.id,
        state: existing.state,
        customerName: patch.customerName ?? existing.customerName,
        customerPhone: patch.customerPhone ?? existing.customerPhone,
        botContext: existing.botContext,
        botFailureCount: existing.botFailureCount,
        created: false,
    };
}
