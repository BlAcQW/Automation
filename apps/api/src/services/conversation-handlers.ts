/**
 * Which engine answers a customer turn.
 *
 * All channels (WhatsApp, Instagram, Messenger) converge on one assistant
 * step; this is the seam where it is chosen per tenant vertical. Pure so it
 * is trivially testable and cannot touch I/O.
 *
 * - 'llm_agent'   : the LLM booking assistant (APPOINTMENTS, LLM configured).
 * - 'unavailable' : no engine can answer; the caller hands off to a human via
 *                   the assistant fallback. Also the fail-safe for any vertical
 *                   we do not recognise.
 *
 * A 'rides_flow' kind is added here when the scripted RIDES engine exists.
 */

export type Vertical = 'APPOINTMENTS' | 'RIDES';

export type ConversationHandlerKind = 'llm_agent' | 'unavailable';

export function selectConversationHandler(
    vertical: string | null | undefined,
    llmEnabled: boolean,
): ConversationHandlerKind {
    switch (vertical) {
        case 'APPOINTMENTS':
            return llmEnabled ? 'llm_agent' : 'unavailable';
        case 'RIDES':
            return 'unavailable';
        default:
            return 'unavailable';
    }
}

/**
 * May a customer typing a resume keyword ("menu", "bot", "start") take a
 * HUMAN_ACTIVE conversation back to the assistant?
 *
 * - Only if there is an assistant to resume to. With none — a vertical whose
 *   engine isn't built, or APPOINTMENTS with the LLM switched off — the next
 *   turn would hand straight back to a human, flapping the state. This is a
 *   deliberate change for every vertical, not only RIDES.
 * - Never for a conversation a staff member has claimed: the customer must
 *   not be able to pull it away (and clear the assignment).
 */
export function canCustomerResumeBot(input: {
    isResumeKeyword: boolean;
    handler: ConversationHandlerKind;
    assignedUserId: string | null | undefined;
}): boolean {
    return input.isResumeKeyword && input.handler !== 'unavailable' && !input.assignedUserId;
}
