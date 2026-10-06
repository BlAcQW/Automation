/**
 * Events a flow raises that are not tied to one payment or message: today only
 * `flow.completed`, announced by whoever ran the step that ended the flow (the
 * turn handler for a customer message, the flow_payment fulfiller for a payment).
 */
import { publishEventSafe } from './events/emit.js';
import type { FlowCompletion } from './flows/index.js';

/**
 * Best-effort (never fails the turn or the payment). `completion.vars` is
 * already the allowlisted subset (shareableVars in flows/engine.ts).
 */
export async function emitFlowCompleted(
    prisma: unknown,
    args: { tenantId: string; conversationId: string; customerId?: string | null; completion: FlowCompletion },
): Promise<void> {
    await publishEventSafe(prisma, {
        tenantId: args.tenantId,
        type: 'flow.completed',
        payload: {
            flowKey: args.completion.flowKey,
            version: args.completion.version,
            conversationId: args.conversationId,
            customerId: args.customerId ?? null,
            vars: args.completion.vars,
        },
    });
}
