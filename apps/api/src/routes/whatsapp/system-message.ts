/**
 * Short system-authored messages (holding / retry), shared by the assistant
 * fallback and the flow and external-app handlers.
 */
import { decrypt } from '../../services/crypto.js';
import { sendChannelText, resolveChannelCredentials } from '../../services/channel-send.js';
import { resolveCredentials, selectCredentialSource } from '../../services/whatsapp-credentials.js';
import { HOLDING_MESSAGE_COOLDOWN_MS } from '../../services/assistant-fallback.js';
import { raiseAlert } from '../../services/alerts.js';
import { emitMessageSent } from '../../services/events/emit.js';

export type ChannelKind = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';

/** A holding message went to this conversation within the cooldown window. */
export async function holdingSentRecently(prisma: any, conversationId: string): Promise<boolean> {
    const since = new Date(Date.now() - HOLDING_MESSAGE_COOLDOWN_MS);
    const recent = await prisma.message.findFirst({
        where: {
            conversationId,
            direction: 'OUTBOUND',
            createdAt: { gte: since },
            metadata: { path: ['kind'], equals: 'holding' },
        },
        select: { id: true },
    });
    return Boolean(recent);
}

/**
 * Send a short system-authored message (holding / retry). Reserves quota
 * atomically, releases it if the send fails, and never throws: by the time
 * this runs the customer-facing outcome is decided, and a failure here must
 * not bubble up and fail the webhook.
 *
 * Deliberately NOT given the reply outbox (reply-outbox.ts). These run only
 * after the agent already failed: 'holding' follows a successful handoff to a
 * human (the conversation is HUMAN_ACTIVE, staff see it and reply), and 'retry'
 * is a cosmetic "try again" nudge. Making their send failure throw would retry
 * the turn and re-run the agent, whose tools may already have acted, which is
 * worse than a lost courtesy message. The failure is logged at error.
 */
export async function sendSystemMessage(
    fastify: any,
    tenant: any,
    conversationId: string,
    input: { channel: ChannelKind; recipientId: string; text: string; kind: string; reason?: string },
): Promise<void> {
    const { tryReserveOutbound, rollbackOutboundReservation } = await import('../../services/usage.js');

    const creds = resolveChannelCredentials(
        tenant,
        input.channel,
        decrypt,
        resolveCredentials(selectCredentialSource(tenant)),
    );
    if (!creds) {
        await raiseAlert(fastify.prisma, {
            kind: 'outbound.no_channel',
            severity: 'warning',
            tenantId: tenant.id,
            message: `Replies on ${input.channel} cannot be sent: the channel is not configured`,
            context: { channel: input.channel },
            dedupeKey: `outbound.no_channel:${tenant.id}:${input.channel}`,
        });
        return;
    }

    const reservation = await tryReserveOutbound(fastify.prisma, tenant.id);
    if (!reservation.ok) {
        if (reservation.reason === 'paused') {
            fastify.log.warn({ tenantId: tenant.id, kind: input.kind }, 'Outbound messaging paused by support — system message suppressed');
        } else {
            fastify.log.warn({ tenantId: tenant.id, kind: input.kind }, 'Quota exhausted — system message suppressed');
        }
        return;
    }

    let providerMessageId: string | undefined;
    try {
        const sent = await sendChannelText({
            channel: input.channel,
            credentials: creds,
            recipientId: input.recipientId,
            text: input.text,
        });
        providerMessageId = sent.messageId;
    } catch (err) {
        fastify.log.error({ err, channel: input.channel, kind: input.kind }, 'Failed to send system message');
        await rollbackOutboundReservation(fastify.prisma, tenant.id).catch(() => undefined);
        return;
    }

    let messageId: string | undefined;
    try {
        const row = await fastify.prisma.message.create({
            data: {
                conversationId,
                direction: 'OUTBOUND',
                content: input.text,
                messageType: 'TEXT',
                whatsappMsgId: providerMessageId ?? null,
                metadata: { source: 'system', kind: input.kind, reason: input.reason ?? null, channel: input.channel },
            },
        });
        messageId = row?.id;
    } catch (err) {
        // Sent and billed; only the transcript row is missing.
        fastify.log.error({ err, conversationId, kind: input.kind }, 'System message sent but not recorded');
    }

    if (messageId) {
        await emitMessageSent(fastify.prisma, {
            tenantId: tenant.id, conversationId, messageId, channel: input.channel, sentBy: 'AI',
        });
    }
}
