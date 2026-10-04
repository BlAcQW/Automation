import { describe, it, expect } from 'vitest';
import {
    planAssistantFallback,
    isDuplicateMessageError,
    ASSISTANT_UNAVAILABLE_REASON,
    HOLDING_MESSAGE,
    RETRY_MESSAGE,
    MAX_CONSECUTIVE_FAILURES,
} from './assistant-fallback';

const base = {
    llmEnabled: true,
    agentThrew: false,
    replySent: false,
    priorFailures: 0,
    holdingSentRecently: false,
};

describe('planAssistantFallback', () => {
    it('lets the agent answer when the LLM is enabled and did not throw', () => {
        expect(planAssistantFallback(base)).toEqual({ action: 'agent' });
    });

    it('hands off immediately with a holding message when the LLM is disabled', () => {
        // Retrying cannot help when there is no assistant at all.
        expect(planAssistantFallback({ ...base, llmEnabled: false })).toEqual({
            action: 'handoff',
            reason: ASSISTANT_UNAVAILABLE_REASON,
            holdingMessage: HOLDING_MESSAGE,
        });
    });

    it('does NOT hand off when the agent threw after its reply was already sent', () => {
        // A failure persisting the reply must not follow a real answer with
        // "someone will reply shortly" and pull the conversation off the bot.
        expect(planAssistantFallback({ ...base, agentThrew: true, replySent: true })).toEqual({
            action: 'none',
        });
    });

    it('asks the customer to retry on a first transient failure, without a handoff', () => {
        // One OpenAI blip must not become a permanent human takeover.
        expect(planAssistantFallback({ ...base, agentThrew: true, priorFailures: 0 })).toEqual({
            action: 'retry_later',
            failures: 1,
            message: RETRY_MESSAGE,
        });
    });

    it('still asks to retry just below the threshold', () => {
        const plan = planAssistantFallback({
            ...base,
            agentThrew: true,
            priorFailures: MAX_CONSECUTIVE_FAILURES - 2,
        });
        expect(plan.action).toBe('retry_later');
    });

    it('hands off once consecutive failures reach the threshold', () => {
        expect(
            planAssistantFallback({ ...base, agentThrew: true, priorFailures: MAX_CONSECUTIVE_FAILURES - 1 }),
        ).toEqual({
            action: 'handoff',
            reason: ASSISTANT_UNAVAILABLE_REASON,
            holdingMessage: HOLDING_MESSAGE,
        });
    });

    it('hands off without re-sending the holding message if one went out recently', () => {
        // Stops a customer typing "menu" repeatedly from drawing a message each time.
        expect(planAssistantFallback({ ...base, llmEnabled: false, holdingSentRecently: true })).toEqual({
            action: 'handoff',
            reason: ASSISTANT_UNAVAILABLE_REASON,
            holdingMessage: null,
        });
    });

    it('uses neutral copy, not a menu or a welcome banner', () => {
        expect(ASSISTANT_UNAVAILABLE_REASON).toBe('assistant_unavailable');
        expect(HOLDING_MESSAGE).toMatch(/someone from the team will reply shortly/i);
        expect(HOLDING_MESSAGE).not.toMatch(/welcome/i);
        expect(RETRY_MESSAGE).not.toMatch(/someone from the team/i);
        expect(MAX_CONSECUTIVE_FAILURES).toBe(3);
    });
});

describe('isDuplicateMessageError', () => {
    it('is true for P2002 on the whatsappMsgId constraint (array target)', () => {
        expect(
            isDuplicateMessageError({ code: 'P2002', meta: { target: ['conversationId', 'whatsappMsgId'] } }),
        ).toBe(true);
    });

    it('is true for P2002 with a constraint-name target', () => {
        expect(
            isDuplicateMessageError({ code: 'P2002', meta: { target: 'Message_conversationId_whatsappMsgId_key' } }),
        ).toBe(true);
    });

    it('is true for P2002 with no target when the model is Message', () => {
        expect(isDuplicateMessageError({ code: 'P2002', meta: { modelName: 'Message' } })).toBe(true);
    });

    it('is false for P2002 with no target and no model, rather than guessing', () => {
        // Swallowing an unidentified unique violation would silently drop a
        // customer's message.
        expect(isDuplicateMessageError({ code: 'P2002' })).toBe(false);
        expect(isDuplicateMessageError({ code: 'P2002', meta: { modelName: 'Conversation' } })).toBe(false);
    });

    it('is false for P2002 on some other constraint', () => {
        expect(isDuplicateMessageError({ code: 'P2002', meta: { target: ['email'] } })).toBe(false);
    });

    it('is false for other codes, plain errors, and non-objects', () => {
        expect(isDuplicateMessageError({ code: 'P2025' })).toBe(false);
        expect(isDuplicateMessageError(new Error('boom'))).toBe(false);
        expect(isDuplicateMessageError(null)).toBe(false);
        expect(isDuplicateMessageError(undefined)).toBe(false);
        expect(isDuplicateMessageError('P2002')).toBe(false);
    });
});
