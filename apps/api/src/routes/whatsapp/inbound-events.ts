/**
 * Per-inbound-message bookkeeping shared by the WhatsApp and Instagram /
 * Messenger paths: link the conversation to its Customer record, then announce
 * the message as a `message.received` event.
 *
 * Both are side channels. Linking never fails a turn. The event is best-effort
 * for ordinary tenants; for a tenant whose conversations belong to an external
 * app the event IS the delivery, so there it is strict (a failure fails the turn
 * and the inbox retries it) and, on a retried turn, de-duplicated against the
 * event the earlier attempt already wrote.
 */
import { resolveCustomerIdSafe, linkConversationToCustomer } from '../../services/customers.js';
import { emitMessageReceived } from '../../services/events/emit.js';
import type { ConversationHandlerKind } from '../../services/conversation-handlers.js';
import type { ChannelKind } from './system-message.js';

export interface InboundConversation {
    id: string;
    customerPhone?: string | null;
    customerName?: string | null;
    customerId?: string | null;
}

/**
 * When a conversation has a phone and no customer yet, find-or-create the
 * Customer and link it. Once linked (`customerId` set on the loaded row) this
 * costs nothing on later messages. Mutates `conversation.customerId` so the
 * rest of the turn sees it. Returns the customer id, if known.
 */
export async function linkCustomerOnInbound(
    fastify: any,
    tenant: any,
    conversation: InboundConversation,
): Promise<string | null> {
    if (conversation.customerId) return conversation.customerId;
    if (!conversation.customerPhone) return null;
    try {
        const customerId = await resolveCustomerIdSafe(
            fastify.prisma,
            {
                tenantId: tenant.id,
                phone: conversation.customerPhone,
                name: conversation.customerName ?? null,
                // Passed (even as null) so a local number never costs a tenant lookup.
                businessNumber: tenant.whatsappDisplayNumber ?? null,
            },
            fastify.log,
        );
        if (!customerId) return null;
        const linked = await linkConversationToCustomer(fastify.prisma, {
            tenantId: tenant.id,
            conversationId: conversation.id,
            customerId,
        });
        if (!linked) return null;
        conversation.customerId = customerId;
        return customerId;
    } catch (err) {
        fastify.log.warn({ err, conversationId: conversation.id }, 'Could not link conversation to a customer');
        return null;
    }
}

/** The tenant's external app exists and is switched on. */
export async function externalAppIsLive(prisma: any, tenantId: string): Promise<boolean> {
    const app = await prisma.externalApp.findFirst({ where: { tenantId }, select: { isActive: true } });
    return Boolean(app?.isActive);
}

export interface InboundInfo {
    /** Stored inbound Message row id. */
    rowId: string | undefined;
    channel: ChannelKind;
    text: string;
    /** Stored message type (TEXT, IMAGE, LOCATION, ...). */
    type: string;
    /** The row existed from an earlier attempt of this same turn. */
    reused: boolean;
}

/** Link the customer, announce the message. Returns whether an external app is live. */
export async function prepareInbound(
    fastify: any,
    tenant: any,
    conversation: InboundConversation,
    handler: ConversationHandlerKind,
    inbound: InboundInfo,
): Promise<{ externalAppLive: boolean }> {
    const customerId = await linkCustomerOnInbound(fastify, tenant, conversation);

    const externalAppLive = handler === 'external_app' ? await externalAppIsLive(fastify.prisma, tenant.id) : false;

    if (inbound.rowId) {
        await emitMessageReceived(fastify.prisma, {
            tenantId: tenant.id,
            conversationId: conversation.id,
            messageId: inbound.rowId,
            channel: inbound.channel,
            customerId,
            text: inbound.text,
            type: inbound.type,
            strict: externalAppLive,
            once: inbound.reused,
        });
    }
    return { externalAppLive };
}
