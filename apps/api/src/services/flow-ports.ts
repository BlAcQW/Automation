/**
 * The real FlowPorts: what a flow's side-effect steps actually do.
 *
 *  - createPaymentLink -> createFulfillmentPaymentLink (own gateway only), with
 *    an entity id that encodes the conversation and the payment step
 *    (flow-payments.ts) and a return URL back into the WhatsApp chat.
 *  - enqueueStaff      -> a hand-off to a person (triggerTakeover) with the
 *    queue name as the reason, or, for a "queue it and carry on" step, an
 *    in-app notification (a takeover would silence the bot, which is exactly
 *    what that step says it does not do).
 *  - runAction         -> the pack action registry.
 *
 * IDEMPOTENCY. Every request carries `idempotencyKey` =
 * `<conversationId>:<inboundOrEventId>:<state>` (engine.ts). What each port does
 * with it, and where that stops:
 *
 *  - createPaymentLink: returns the link already held in the conversation's
 *    persisted flow state when the flow is waiting at that state, for that same
 *    inbound, with a link recorded. That covers a re-run after the state was
 *    saved. It does NOT cover a crash or lost state write between Paystack
 *    creating the link and the state being saved: the re-run makes a second
 *    link, because nothing outside the flow state remembers the first (adding
 *    that needs a table). The damage is bounded: both links name the same
 *    conversation and step, the first payment advances the flow, and a second
 *    payment finds the flow elsewhere and raises a `flow_payment.unmatched`
 *    alert so a person can refund it.
 *  - enqueueStaff: a takeover is idempotent by nature (it sets a state). The
 *    "carry on" notification is not deduplicated: a replayed turn can notify
 *    staff twice.
 *  - runAction: passes the key through; the pack's action is responsible for
 *    honouring it.
 */
import type { FlowPorts, PaymentLinkRequest, StaffRequest } from './flows/index.js';
import { readFlowState, runRegisteredAction } from './flows/index.js';
import { createFulfillmentPaymentLink } from './payment-link.js';
import { canEncodeFlowEntityId, encodeFlowEntityId } from './flow-entity-id.js';
import { triggerTakeover } from './human-takeover.js';
import { createNotification } from './notifications.js';

export interface FlowPortsDeps {
    prisma: any;
    tenant: { id: string; paystackSecretKey?: string | null; whatsappDisplayNumber?: string | null };
    log: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

/** `<conversationId>:<inboundOrEventId>:<state>` -> its two variable parts. */
export function parseIdempotencyKey(key: string, conversationId: string): { inboundId: string; state: string } | null {
    const prefix = `${conversationId}:`;
    if (!key.startsWith(prefix)) return null;
    const rest = key.slice(prefix.length);
    const cut = rest.lastIndexOf(':');
    if (cut <= 0 || cut === rest.length - 1) return null;
    return { inboundId: rest.slice(0, cut), state: rest.slice(cut + 1) };
}

/** wa.me link back into the business's WhatsApp chat, when its number is known. */
export function whatsappReturnUrl(displayNumber: string | null | undefined): string | undefined {
    const digits = (displayNumber ?? '').replace(/[^0-9]/g, '');
    return digits.length >= 7 && digits.length <= 15 ? `https://wa.me/${digits}` : undefined;
}

async function existingLink(
    prisma: any,
    req: PaymentLinkRequest,
    parsed: { inboundId: string; state: string },
): Promise<{ url: string; reference?: string } | null> {
    const row = await prisma.conversation.findFirst({
        where: { id: req.conversationId, tenantId: req.tenantId },
        select: { botContext: true },
    });
    const state = readFlowState(row?.botContext);
    if (!state || state.status !== 'waiting' || state.current !== parsed.state) return null;
    if (state.lastInboundId !== parsed.inboundId && state.lastEventId !== parsed.inboundId) return null;
    const url = state.vars.payment_url;
    if (!url) return null;
    return { url, ...(state.vars.payment_reference ? { reference: state.vars.payment_reference } : {}) };
}

export function createFlowPorts(deps: FlowPortsDeps): FlowPorts {
    const { prisma, tenant, log } = deps;

    return {
        async createPaymentLink(req: PaymentLinkRequest) {
            if (req.tenantId !== tenant.id) {
                log.error({ tenantId: req.tenantId, expected: tenant.id }, 'Flow payment link requested for another tenant');
                return null;
            }
            const parsed = parseIdempotencyKey(req.idempotencyKey, req.conversationId);
            if (!parsed) {
                log.error({ key: req.idempotencyKey }, 'Flow payment link with an unusable idempotency key');
                return null;
            }

            const held = await existingLink(prisma, req, parsed);
            if (held) return held;

            const amountMinor = Math.round(req.amount * 100);
            const entity = { conversationId: req.conversationId, state: parsed.state, amountMinor, currency: req.currency };
            // Before Paystack: a link whose entity id cannot be decoded later takes the money and never advances the flow.
            if (!canEncodeFlowEntityId(entity)) {
                log.error({ conversationId: req.conversationId, state: parsed.state, amountMinor }, 'Flow payment amount cannot be encoded in the entity id; no link created');
                return null;
            }
            let reference: string | undefined;
            const url = await createFulfillmentPaymentLink({
                tenantId: tenant.id,
                paystackSecretKeyEncrypted: tenant.paystackSecretKey ?? null,
                currency: req.currency,
                kind: req.kind,
                entityId: encodeFlowEntityId(entity),
                amount: req.amount,
                customerPhone: req.customerPhone ?? '',
                callbackUrl: whatsappReturnUrl(tenant.whatsappDisplayNumber),
                // The entity is the conversation's flow state, which the engine
                // saves (payment_url, payment_reference) right after this returns.
                onCreated: ({ reference: ref }) => { reference = ref; },
            });
            return url ? { url, ...(reference ? { reference } : {}) } : null;
        },

        async enqueueStaff(req: StaffRequest) {
            if (req.tenantId !== tenant.id) throw new Error('flow staff request for another tenant');
            if (req.handoff) {
                await triggerTakeover(prisma, req.conversationId, req.queue ?? 'flow_staff');
                return;
            }
            await createNotification(prisma, {
                tenantId: tenant.id,
                type: 'SYSTEM',
                title: 'Customer waiting for staff',
                message: req.queue ? `A customer was placed in the "${req.queue}" queue.` : 'A customer was placed in the staff queue.',
                metadata: { kind: 'flow_staff_queue', conversationId: req.conversationId, queue: req.queue },
            }, { warn: (obj, msg) => log.warn(obj as object, msg ?? 'notification warning') });
        },

        runAction: (req) => runRegisteredAction(req),
    };
}
