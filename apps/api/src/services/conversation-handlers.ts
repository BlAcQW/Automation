/**
 * Which engine answers a customer turn.
 *
 * All channels (WhatsApp, Instagram, Messenger) converge on one assistant
 * step; this is the seam where it is chosen per tenant. Pure so it is trivially
 * testable and cannot touch I/O.
 *
 * Choice order:
 *  1. The tenant's `conversationMode` override ('llm' | 'flow' | 'external').
 *     An unknown value fails safe to 'unavailable' (a typo must hand the
 *     conversation to a human, not silently run some other engine).
 *  2. No override (null / undefined): the vertical's default. APPOINTMENTS is
 *     the LLM assistant (when the LLM is configured), RIDES is the scripted
 *     flow, anything else is 'unavailable'.
 *
 * Kinds:
 * - 'llm_agent'    : the LLM booking assistant. Needs the LLM configured.
 * - 'flow'         : the scripted workflow engine (services/flows).
 * - 'external_app' : the tenant's own app answers; Bookly sends no reply and
 *                    delivers `message.received` instead.
 * - 'unavailable'  : no engine can answer; the caller hands off to a human via
 *                    the assistant fallback.
 */

export type Vertical = 'APPOINTMENTS' | 'RIDES';

export type ConversationMode = 'llm' | 'flow' | 'external';

export type ConversationHandlerKind = 'llm_agent' | 'flow' | 'external_app' | 'unavailable';

function verticalDefault(vertical: string | null | undefined, llmEnabled: boolean): ConversationHandlerKind {
    switch (vertical) {
        case 'APPOINTMENTS':
            return llmEnabled ? 'llm_agent' : 'unavailable';
        case 'RIDES':
            return 'flow';
        default:
            return 'unavailable';
    }
}

export function selectConversationHandler(
    vertical: string | null | undefined,
    llmEnabled: boolean,
    conversationMode?: string | null,
): ConversationHandlerKind {
    if (conversationMode === null || conversationMode === undefined) {
        return verticalDefault(vertical, llmEnabled);
    }
    switch (conversationMode) {
        case 'llm':
            return llmEnabled ? 'llm_agent' : 'unavailable';
        case 'flow':
            return 'flow';
        case 'external':
            return 'external_app';
        default:
            return 'unavailable';
    }
}

/**
 * May a customer typing a resume keyword ("menu", "bot", "start") take a
 * HUMAN_ACTIVE conversation back to the assistant?
 *
 * - Only if there is an assistant to resume to. With none (APPOINTMENTS with
 *   the LLM switched off, an unknown vertical or mode) the next turn would hand
 *   straight back to a human, flapping the state. A 'flow' counts as an
 *   assistant. An 'external_app' does NOT: the app decides when a conversation
 *   returns to automation (POST /v1/conversations/:id/resume), not a keyword.
 * - Never for a conversation a staff member has claimed: the customer must
 *   not be able to pull it away (and clear the assignment).
 */
export function canCustomerResumeBot(input: {
    isResumeKeyword: boolean;
    handler: ConversationHandlerKind;
    assignedUserId: string | null | undefined;
}): boolean {
    return (
        input.isResumeKeyword &&
        input.handler !== 'unavailable' &&
        input.handler !== 'external_app' &&
        !input.assignedUserId
    );
}
