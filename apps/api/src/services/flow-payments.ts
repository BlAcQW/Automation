/**
 * The generic 'flow_payment' payment fulfiller: a verified charge for a flow's
 * payment step advances that conversation's flow.
 *
 * A flow's `payment` step (kind 'flow_payment') creates a link whose entity id
 * encodes the conversation, the step and the amount (flow-entity-id.ts). When
 * the Paystack webhook has verified the charge with the tenant's own key and
 * cross-checked kind + entity + tenant (payment-fulfillers.ts), it lands here:
 *
 *   1. validate the entity id and the amount/currency against what was asked
 *   2. publish `payment.succeeded` ONCE per reference (advisory lock +
 *      existing-event check, like services/external-app.ts)
 *   3. advanceFlow for the conversation, only if it is waiting at THAT step on
 *      THAT link (the event's reference equals the step's payment_reference and
 *      Paystack's amount covers the CURRENT step's amount): an old cheaper link
 *      paid after the customer picked a dearer option advances nothing
 *   4. send the flow's reply through the reply outbox, take the conversation to
 *      a person if the flow handed off
 *
 * ORDER AND RETRIES. The event is published before the flow advances, and a
 * transient failure (events table, database) throws so Paystack retries. A
 * retry finds the event ('duplicate') and still advances the flow, so a crash
 * between 2 and 3 loses neither. advanceFlow ignores a reference it already
 * applied, so a redelivery after 3 changes nothing.
 *
 * The reply is the one thing that cannot be retried by throwing: once the flow
 * advanced, a retry is a no-op and would not resend it. So a send failure is
 * logged and alerted (the text stays in the outbox as PENDING for a person to
 * see) but never fails the fulfilment.
 *
 * UNDERPAID. A charge below what its link asked is rejected (the webhook
 * records it as an unattributed payment, so a person refunds it), recorded once
 * as `payment.failed`, and, when the flow is waiting on exactly that link, the
 * flow takes its failure branch so the customer is told.
 *
 * Money with no home (the flow is not at that step, e.g. a second payment for
 * the same link) is still recorded as an event, and raises an alert so a person
 * can refund it.
 */
import type { FulfillmentInput, FulfillmentOutcome } from './payment-fulfillers.js';
import { isRegisteredFulfillmentKind, registerPaymentFulfiller } from './payment-fulfillers.js';
import { advanceFlow, createPrismaFlowStore, readFlowState, FLOW_CONFLICT_REPLY } from './flows/index.js';
import { createFlowPorts } from './flow-ports.js';
import { emitFlowCompleted } from './flow-events.js';
import { canEncodeFlowEntityId, decodeFlowEntityId, encodeFlowEntityId } from './flow-entity-id.js';
import { publishEventOnce } from './events/emit.js';
import { triggerTakeover } from './human-takeover.js';
import { raiseAlert } from './alerts.js';
import { tenantChannelCreds } from './tenant-channel-creds.js';
import { deliverReply, ReplySendError } from '../routes/whatsapp/reply-outbox.js';

export const FLOW_PAYMENT_KIND = 'flow_payment';
export { encodeFlowEntityId, decodeFlowEntityId, canEncodeFlowEntityId };

/** Same one-minor-unit rounding tolerance as payment-fulfillment.ts. */
const UNDERPAYMENT_TOLERANCE_MINOR = 1;
const MAX_REFERENCE_LENGTH = 200;

async function loadConversation(prisma: any, tenantId: string, conversationId: string) {
    return prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true, channel: true, externalId: true, state: true, botContext: true, customerId: true },
    });
}

async function sendFlowReply(
    input: FulfillmentInput,
    tenant: any,
    conv: { id: string; channel: any; externalId: string },
    reply: string,
): Promise<void> {
    const { prisma, tenantId, log } = input;
    try {
        await deliverReply({ prisma, log }, tenant, {
            conversationId: conv.id,
            channel: conv.channel,
            creds: tenantChannelCreds(tenant, conv.channel),
            recipientId: conv.externalId,
            text: reply,
            metadata: { source: 'flow', channel: conv.channel, trigger: 'payment' },
        });
    } catch (err) {
        // ReplySendError: stored PENDING. Anything else (row could not be stored): nothing stored.
        log.error({ err, conversationId: conv.id, stored: err instanceof ReplySendError }, 'Flow payment reply not delivered');
        await raiseAlert(prisma, {
            kind: 'flow_payment.reply_failed',
            severity: 'warning',
            tenantId,
            message: 'A customer paid but the confirmation message could not be sent',
            context: { conversationId: conv.id },
            dedupeKey: `flow_payment.reply_failed:${tenantId}:${conv.id}`,
        });
    }
}

async function fulfillFlowPayment(input: FulfillmentInput): Promise<FulfillmentOutcome> {
    const { prisma, tenantId, entityId, reference, amountMinor, currency, log } = input;

    const entity = decodeFlowEntityId(entityId);
    if (!entity) return { status: 'rejected', reason: 'entity_ref_invalid' };
    if (!reference || reference.length > MAX_REFERENCE_LENGTH) return { status: 'rejected', reason: 'reference_invalid' };
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { status: 'rejected', reason: 'amount_invalid' };
    if (!/^[A-Za-z]{3}$/.test(currency ?? '')) return { status: 'rejected', reason: 'currency_invalid' };
    if (currency.toUpperCase() !== entity.currency) return { status: 'rejected', reason: 'currency_mismatch' };

    const conv = await loadConversation(prisma, tenantId, entity.conversationId);
    if (!conv) return { status: 'rejected', reason: 'conversation_not_found' };
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return { status: 'rejected', reason: 'tenant_not_found' };

    // Overpayment is accepted (refusing it would strand the customer's money).
    if (amountMinor < entity.amountMinor - UNDERPAYMENT_TOLERANCE_MINOR) {
        return fulfillUnderpayment(input, entity, conv, tenant);
    }

    // 2. The money fact, once per reference. Throws on a transient failure.
    const published = await publishEventOnce(
        prisma,
        {
            tenantId,
            type: 'payment.succeeded',
            payload: {
                paymentId: reference,
                amount: amountMinor,
                currency: currency.toUpperCase(),
                reference,
                conversationId: conv.id,
                entityRef: entityId,
            },
        },
        { field: 'reference', equals: reference },
    );

    // 3. Advance the flow, only if it is waiting at the step this link was for
    // AND on THIS link: the same step name can hold a newer link (the customer
    // changed their mind), and an old cheaper link must not pay for it.
    const before = readFlowState(conv.botContext);
    const atStep = isWaitingOnThisLink(before, entity.state, reference);

    let advanced = false;
    let reply = '';
    let wantsHuman = false;
    if (atStep) {
        const result = await advanceFlow(flowDeps(input, tenant), {
            tenantId,
            conversationId: conv.id,
            event: {
                type: 'payment.succeeded',
                eventId: reference,
                kind: FLOW_PAYMENT_KIND,
                // The engine re-checks both against the CURRENT step (belt and braces).
                reference,
                amountMinor,
                currency: currency.toUpperCase(),
            },
            vertical: tenant.vertical ?? undefined,
            currency: tenant.paymentCurrency ?? undefined,
        });
        // State could not be saved: transient, let Paystack retry (the event is already recorded).
        if (!result.applied && result.reply === FLOW_CONFLICT_REPLY) throw new Error('flow_state_conflict');
        advanced = result.applied;
        reply = result.reply.trim();
        wantsHuman = result.wantsHuman;
        if (result.applied && result.completed) {
            await emitFlowCompleted(prisma, { tenantId, conversationId: conv.id, customerId: conv.customerId, completion: result.completed });
        }
    }

    if (!advanced) {
        // Someone else (a concurrent delivery) may have applied this very reference.
        const after = await loadConversation(prisma, tenantId, conv.id);
        const processed = readFlowState(after?.botContext)?.lastEventId === reference;
        if (!processed) {
            // Whenever the money is unmatched and unprocessed, not only on the
            // first delivery: a retry after the alert step failed must still
            // raise it (the dedupeKey, per reference, prevents duplicates).
            await raiseAlert(prisma, {
                kind: 'flow_payment.unmatched',
                severity: 'warning',
                tenantId,
                message: 'A flow payment arrived but the conversation was not waiting for it. It may need a refund.',
                context: { conversationId: conv.id, reference, paymentState: entity.state, flowStatus: before?.status ?? null, flowStep: before?.current ?? null },
                dedupeKey: `flow_payment.unmatched:${tenantId}:${reference}`,
            });
            if (published === 'published') return { status: 'applied' };
        }
        if (wantsHuman) await handOff(input, conv.id, 'flow_payment_unusable');
        return { status: 'already_applied' };
    }

    // 4. Customer-facing outcome. A hand-off goes first: it is the load-bearing part.
    if (wantsHuman) await handOff(input, conv.id, 'flow_handoff');
    if (reply) await sendFlowReply(input, tenant, conv, reply);
    return { status: 'applied' };
}

function flowDeps(input: FulfillmentInput, tenant: any) {
    return {
        store: createPrismaFlowStore(input.prisma),
        ports: createFlowPorts({ prisma: input.prisma, tenant, log: input.log }),
        log: input.log,
    };
}

/** The flow waits at the step the link was made for, and that step's CURRENT link is `reference`. */
function isWaitingOnThisLink(state: ReturnType<typeof readFlowState>, paymentState: string, reference: string): boolean {
    if (state?.status !== 'waiting' || state.current !== paymentState) return false;
    const held = state.vars.payment_reference;
    // A step whose link has no recorded reference cannot be compared here; the
    // engine then falls back to checking the amount against the current step.
    return !held || held === reference;
}

/**
 * Money arrived for a link but less than it asked. Nothing is fulfilled. The
 * failure is recorded once per reference (throws on a transient failure so
 * Paystack retries), and, when the flow is waiting on exactly this link, the
 * flow takes its failure branch so the customer is told. The caller (the
 * webhook) records the rejected charge as an unattributed payment, which is the
 * alert that a person must refund the partial amount.
 */
async function fulfillUnderpayment(
    input: FulfillmentInput,
    entity: NonNullable<ReturnType<typeof decodeFlowEntityId>>,
    conv: { id: string; channel: any; externalId: string; botContext: unknown; customerId?: string | null },
    tenant: any,
): Promise<FulfillmentOutcome> {
    const { prisma, tenantId, reference, amountMinor, currency } = input;
    const rejected: FulfillmentOutcome = { status: 'rejected', reason: 'amount_insufficient' };

    await publishEventOnce(
        prisma,
        {
            tenantId,
            type: 'payment.failed',
            payload: {
                paymentId: reference,
                amount: amountMinor,
                currency: currency.toUpperCase(),
                reference,
                conversationId: conv.id,
                entityRef: input.entityId,
                reason: 'underpaid',
            },
        },
        { field: 'reference', equals: reference },
    );

    const state = readFlowState(conv.botContext);
    // A recorded reference must match; an unrecorded one is not enough to blame this link.
    if (!isWaitingOnThisLink(state, entity.state, reference) || !state?.vars.payment_reference) return rejected;

    const result = await advanceFlow(flowDeps(input, tenant), {
        tenantId,
        conversationId: conv.id,
        event: { type: 'payment.failed', eventId: reference, kind: FLOW_PAYMENT_KIND, reference },
        vertical: tenant.vertical ?? undefined,
        currency: tenant.paymentCurrency ?? undefined,
    });
    if (!result.applied && result.reply === FLOW_CONFLICT_REPLY) throw new Error('flow_state_conflict');
    if (!result.applied) return rejected;
    if (result.completed) {
        await emitFlowCompleted(prisma, { tenantId, conversationId: conv.id, customerId: conv.customerId, completion: result.completed });
    }
    if (result.wantsHuman) await handOff(input, conv.id, 'flow_payment_failed');
    const reply = result.reply.trim();
    if (reply) await sendFlowReply(input, tenant, conv, reply);
    return rejected;
}

/** Take the conversation to a person unless a staff step already did. */
async function handOff(input: FulfillmentInput, conversationId: string, reason: string): Promise<void> {
    const { prisma, tenantId, log } = input;
    try {
        const now = await loadConversation(prisma, tenantId, conversationId);
        if (now?.state === 'HUMAN_ACTIVE') return;
        await triggerTakeover(prisma, conversationId, reason);
    } catch (err) {
        log.error({ err, conversationId }, 'Hand-off after a flow payment failed');
        await raiseAlert(prisma, {
            kind: 'flow_payment.handoff_failed',
            severity: 'warning',
            tenantId,
            message: 'A flow asked for a person after a payment but the hand-off failed',
            context: { conversationId },
            dedupeKey: `flow_payment.handoff_failed:${tenantId}:${conversationId}`,
        });
    }
}

/** Safe to call more than once. */
export function registerFlowPaymentFulfiller(): void {
    if (isRegisteredFulfillmentKind(FLOW_PAYMENT_KIND)) return;
    registerPaymentFulfiller(FLOW_PAYMENT_KIND, fulfillFlowPayment);
}
