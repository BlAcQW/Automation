import { describe, it, expect } from 'vitest';
import { selectConversationHandler, canCustomerResumeBot } from './conversation-handlers';

describe('selectConversationHandler', () => {
    it('uses the LLM agent for APPOINTMENTS when the LLM is enabled', () => {
        expect(selectConversationHandler('APPOINTMENTS', true)).toBe('llm_agent');
    });

    it('is unavailable for APPOINTMENTS when the LLM is disabled', () => {
        expect(selectConversationHandler('APPOINTMENTS', false)).toBe('unavailable');
    });

    it('is unavailable for RIDES regardless of llmEnabled (no scripted engine yet)', () => {
        expect(selectConversationHandler('RIDES', true)).toBe('unavailable');
        expect(selectConversationHandler('RIDES', false)).toBe('unavailable');
    });

    it('fails safe to unavailable for unknown, null or undefined verticals', () => {
        expect(selectConversationHandler('TAXI_BOATS', true)).toBe('unavailable');
        expect(selectConversationHandler('', true)).toBe('unavailable');
        expect(selectConversationHandler(null, true)).toBe('unavailable');
        expect(selectConversationHandler(undefined, true)).toBe('unavailable');
    });
});

describe('canCustomerResumeBot', () => {
    const ok = { isResumeKeyword: true, handler: 'llm_agent' as const, assignedUserId: null };

    it('resumes on a keyword when an assistant exists and nobody owns the conversation', () => {
        expect(canCustomerResumeBot(ok)).toBe(true);
    });

    it('does not resume on ordinary text', () => {
        expect(canCustomerResumeBot({ ...ok, isResumeKeyword: false })).toBe(false);
    });

    it('does not resume a conversation a staff member has claimed', () => {
        expect(canCustomerResumeBot({ ...ok, assignedUserId: 'user_1' })).toBe(false);
    });

    it('does not resume when there is no assistant to resume to — for ANY vertical', () => {
        // Deliberate, including APPOINTMENTS with the LLM switched off: the
        // next turn would only hand straight back to a human, flapping state
        // and drawing another holding message.
        expect(canCustomerResumeBot({ ...ok, handler: 'unavailable' })).toBe(false);
    });
});
