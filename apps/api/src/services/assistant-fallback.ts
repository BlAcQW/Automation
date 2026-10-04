/**
 * What to do when the LLM assistant cannot answer a customer turn.
 *
 * There is no scripted menu to fall back to any more. The rules:
 *
 * - No assistant at all (no API key): hand to a human straight away —
 *   retrying cannot help.
 * - The assistant threw AFTER its reply went out: do nothing more. The
 *   customer already has their answer; following it with "someone will reply"
 *   and pulling the conversation off the bot would be wrong.
 * - The assistant threw before replying: a transient blip. Ask the customer to
 *   try again and count the failure. Only MAX_CONSECUTIVE_FAILURES in a row
 *   hand off, so one provider hiccup is not a permanent human takeover and an
 *   outage does not flood staff with every conversation at once.
 */

export const ASSISTANT_UNAVAILABLE_REASON = 'assistant_unavailable';

export const MAX_CONSECUTIVE_FAILURES = 3;

/** How long after a holding message another one is withheld. */
export const HOLDING_MESSAGE_COOLDOWN_MS = 10 * 60 * 1000;

export const HOLDING_MESSAGE =
    'Thanks for your message — someone from the team will reply shortly.';

export const RETRY_MESSAGE =
    "Sorry, I couldn't process that just now. Please send your message again in a moment.";

export type AssistantFallbackPlan =
    | { action: 'agent' }
    | { action: 'none' }
    | { action: 'retry_later'; failures: number; message: string }
    | { action: 'handoff'; reason: string; holdingMessage: string | null };

export interface AssistantFallbackInput {
    llmEnabled: boolean;
    agentThrew: boolean;
    /** True once the assistant's reply has been delivered to the customer. */
    replySent: boolean;
    /** `Conversation.botFailureCount` before this turn. */
    priorFailures: number;
    /** A holding message went out within HOLDING_MESSAGE_COOLDOWN_MS. */
    holdingSentRecently: boolean;
}

export function planAssistantFallback(input: AssistantFallbackInput): AssistantFallbackPlan {
    if (input.llmEnabled && !input.agentThrew) return { action: 'agent' };

    const handoff: AssistantFallbackPlan = {
        action: 'handoff',
        reason: ASSISTANT_UNAVAILABLE_REASON,
        holdingMessage: input.holdingSentRecently ? null : HOLDING_MESSAGE,
    };

    if (!input.llmEnabled) return handoff;
    if (input.replySent) return { action: 'none' };

    const failures = input.priorFailures + 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES) return handoff;
    return { action: 'retry_later', failures, message: RETRY_MESSAGE };
}

/**
 * True when `err` is Prisma's unique-constraint violation (P2002) for the
 * (conversationId, whatsappMsgId) inbound dedupe constraint. Matches by error
 * code, so it does not depend on regenerated Prisma types.
 *
 * When Prisma omits the constraint target, the model must be identifiable as
 * Message — otherwise this refuses to guess, because treating an unrelated
 * unique violation as a duplicate silently drops a customer's message.
 */
export function isDuplicateMessageError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const { code, meta } = err as {
        code?: unknown;
        meta?: { target?: unknown; modelName?: unknown };
    };
    if (code !== 'P2002') return false;
    const target = meta?.target;
    if (target === undefined || target === null) return meta?.modelName === 'Message';
    const names = Array.isArray(target) ? target.map(String) : [String(target)];
    return names.some((n) => n.includes('whatsappMsgId'));
}
