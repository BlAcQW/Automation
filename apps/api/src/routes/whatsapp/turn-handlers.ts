/**
 * The 'flow' and 'external_app' conversation handlers (the 'llm_agent' one is
 * handleWithAgent in index.ts). Shared by WhatsApp and Instagram / Messenger.
 *
 * FLOW. runFlowTurn with the real store and ports (services/flow-ports.ts). The
 * reply goes through the same reply outbox as the agent's, so a flow gets the
 * same no-lost-reply guarantee: stored before the send, re-sent (not re-run) on
 * retry. A flow that asks for a human takes the conversation off the bot FIRST
 * (it is the load-bearing part, as in the agent path), then sends what it said.
 * The holding message is only sent when the flow said nothing itself.
 *
 * EXTERNAL APP. No bot reply: the message was already announced as
 * `message.received` (inbound-events.ts). Here only the unavailable-app case
 * remains: no active app means nobody would ever answer, so a person does.
 */
import { createPrismaFlowStore, runFlowTurn, type FlowInput } from '../../services/flows/index.js';
import { createFlowPorts } from '../../services/flow-ports.js';
import { emitFlowCompleted } from '../../services/flow-events.js';
import { triggerTakeover } from '../../services/human-takeover.js';
import { HOLDING_MESSAGE } from '../../services/assistant-fallback.js';
import { raiseAlert } from '../../services/alerts.js';
import { tenantChannelCreds } from '../../services/tenant-channel-creds.js';
import { selectConversationHandler, type ConversationHandlerKind } from '../../services/conversation-handlers.js';
import { deliverReply } from './reply-outbox.js';
import { holdingSentRecently, sendSystemMessage, type ChannelKind } from './system-message.js';

/** Which engine answers this tenant's turn. The only place the seam is called from. */
export async function resolveHandler(tenant: any): Promise<ConversationHandlerKind> {
    const { isLlmEnabled } = await import('../../services/llm-agent.js');
    return selectConversationHandler(tenant.vertical ?? 'APPOINTMENTS', isLlmEnabled(), tenant.conversationMode ?? null);
}

export interface TurnInput {
    channel: ChannelKind;
    /** Who to reply to on this channel: phone, PSID or IGSID. */
    recipientId: string;
    text: string;
    /** Stored inbound Message row (links the reply in the outbox). */
    inboundRowId: string | undefined;
    /** The provider's message id: the flow's idempotency key for the turn. */
    providerMessageId?: string | null;
    /** WhatsApp button / list row id. */
    interactiveId?: string;
    location?: FlowInput['location'];
}

const HANDOFF_REASON_BY_TOOL: Record<string, string> = {
    'flow:unavailable': 'flow_unavailable',
    'flow:conflict': 'flow_conflict',
};

function handoffReason(toolsUsed: string[]): string {
    for (const t of toolsUsed) if (HANDOFF_REASON_BY_TOOL[t]) return HANDOFF_REASON_BY_TOOL[t];
    return 'flow_handoff';
}

/** Take the conversation off the bot unless something (a staff step) already did. */
async function takeOverIfNeeded(fastify: any, tenant: any, conversationId: string, reason: string): Promise<boolean> {
    const current = await fastify.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: tenant.id },
        select: { state: true },
    });
    if (current?.state === 'HUMAN_ACTIVE') return true;
    try {
        await triggerTakeover(fastify.prisma, conversationId, reason);
        return true;
    } catch (err) {
        fastify.log.error({ err, conversationId, reason }, 'Takeover failed');
        await raiseAlert(fastify.prisma, {
            kind: 'conversation.handoff_failed',
            severity: 'warning',
            tenantId: tenant.id,
            message: 'A conversation should have been handed to a person but the hand-off failed',
            context: { conversationId, reason },
            dedupeKey: `conversation.handoff_failed:${tenant.id}:${conversationId}`,
        });
        return false;
    }
}

/** Hand off, then (cooldown permitting) one neutral holding message. */
export async function handOffWithHolding(
    fastify: any,
    tenant: any,
    conversationId: string,
    input: { reason: string; channel: ChannelKind; recipientId: string },
): Promise<void> {
    // Takeover first: if it fails, send nothing (a holding message with the bot
    // still active would repeat every turn).
    if (!(await takeOverIfNeeded(fastify, tenant, conversationId, input.reason))) return;
    if (await holdingSentRecently(fastify.prisma, conversationId)) return;
    await sendSystemMessage(fastify, tenant, conversationId, {
        channel: input.channel,
        recipientId: input.recipientId,
        text: HOLDING_MESSAGE,
        kind: 'holding',
        reason: input.reason,
    });
}

export async function handleWithFlow(
    fastify: any,
    tenant: any,
    conversation: { id: string; customerId?: string | null },
    input: TurnInput,
): Promise<void> {
    const { checkOutboundQuota } = await import('../../services/usage.js');

    // Same early exit as the agent: a flow's steps have real side effects
    // (payment links), so do not run one whose reply could not be sent anyway.
    const quota = await checkOutboundQuota(fastify.prisma, tenant.id);
    if (!quota.ok) {
        if (quota.paused) {
            fastify.log.warn({ tenantId: tenant.id }, 'Outbound messaging paused by support — flow turn suppressed');
        } else {
            fastify.log.warn({ tenantId: tenant.id }, 'Quota exhausted — flow turn suppressed');
        }
        return;
    }

    const inboundId = input.providerMessageId || input.inboundRowId;
    if (!inboundId) throw new Error('flow turn needs an inbound message id');

    // Default flow rows (tenantId null) are read here, in the webhook/worker,
    // outside any tenant context, as the store requires.
    const store = createPrismaFlowStore(fastify.prisma);
    const loaded = await store.loadConversation(tenant.id, conversation.id);
    if (!loaded) throw new Error(`flow turn: conversation ${conversation.id} not found`);

    const result = await runFlowTurn(
        {
            store,
            ports: createFlowPorts({ prisma: fastify.prisma, tenant, log: fastify.log }),
            log: fastify.log,
        },
        {
            tenant: {
                id: tenant.id,
                vertical: tenant.vertical ?? 'APPOINTMENTS',
                activeFlowKey: tenant.activeFlowKey ?? null,
                currency: tenant.paymentCurrency ?? null,
            },
            conversation: loaded,
            inbound: {
                inboundId,
                text: input.text,
                ...(input.interactiveId ? { interactiveId: input.interactiveId } : {}),
                ...(input.location ? { location: input.location } : {}),
            },
        },
    );

    // The turn is saved (runFlowTurn returns after the state write), so the flow really ended.
    if (result.completed) {
        await emitFlowCompleted(fastify.prisma, {
            tenantId: tenant.id,
            conversationId: conversation.id,
            customerId: conversation.customerId ?? null,
            completion: result.completed,
        });
    }

    const reply = result.reply.trim();
    const reason = handoffReason(result.toolsUsed);

    if (result.wantsHuman) {
        if (reply) await takeOverIfNeeded(fastify, tenant, conversation.id, reason);
        else {
            // The flow had nothing to say (e.g. no usable definition).
            await handOffWithHolding(fastify, tenant, conversation.id, { reason, channel: input.channel, recipientId: input.recipientId });
            return;
        }
    }
    if (!reply) return; // a replayed turn, or a flow step with nothing to say

    // Stored PENDING before the send; a send failure throws ReplySendError so
    // the turn is retried by re-sending this text, not by re-running the flow.
    await deliverReply(fastify, tenant, {
        conversationId: conversation.id,
        channel: input.channel,
        creds: tenantChannelCreds(tenant, input.channel),
        recipientId: input.recipientId,
        text: reply,
        inboundId: input.inboundRowId,
        metadata: { source: 'flow', channel: input.channel, tools: result.toolsUsed },
    });
}

/**
 * The tenant's conversations belong to an external app that is missing or
 * switched off: hand off to a person and raise one alert per tenant.
 */
export async function handleExternalAppUnavailable(
    fastify: any,
    tenant: any,
    conversation: { id: string },
    input: { channel: ChannelKind; recipientId: string },
): Promise<void> {
    await raiseAlert(fastify.prisma, {
        kind: 'external_app.unavailable',
        severity: 'warning',
        tenantId: tenant.id,
        message: 'Customers are messaging a business whose external app is missing or switched off. Conversations are going to a person.',
        context: { channel: input.channel },
        dedupeKey: `external_app.unavailable:${tenant.id}`,
    });
    await handOffWithHolding(fastify, tenant, conversation.id, {
        reason: 'external_app_unavailable',
        channel: input.channel,
        recipientId: input.recipientId,
    });
}
