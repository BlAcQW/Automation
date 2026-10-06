import { describe, it, expect } from 'vitest';
import { selectConversationHandler, canCustomerResumeBot } from './conversation-handlers';

describe('selectConversationHandler (vertical default, no override)', () => {
    it('uses the LLM agent for APPOINTMENTS when the LLM is enabled', () => {
        expect(selectConversationHandler('APPOINTMENTS', true)).toBe('llm_agent');
        expect(selectConversationHandler('APPOINTMENTS', true, null)).toBe('llm_agent');
    });

    it('is unavailable for APPOINTMENTS when the LLM is disabled', () => {
        expect(selectConversationHandler('APPOINTMENTS', false)).toBe('unavailable');
    });

    it('runs the scripted flow for RIDES regardless of llmEnabled', () => {
        expect(selectConversationHandler('RIDES', true)).toBe('flow');
        expect(selectConversationHandler('RIDES', false)).toBe('flow');
        expect(selectConversationHandler('RIDES', false, null)).toBe('flow');
    });

    it('fails safe to unavailable for unknown, null or undefined verticals', () => {
        expect(selectConversationHandler('TAXI_BOATS', true)).toBe('unavailable');
        expect(selectConversationHandler('', true)).toBe('unavailable');
        expect(selectConversationHandler(null, true)).toBe('unavailable');
        expect(selectConversationHandler(undefined, true)).toBe('unavailable');
    });
});

describe('selectConversationHandler (conversationMode override)', () => {
    // mode x vertical x llmEnabled. An explicit valid override wins over the
    // vertical default; 'llm' still needs the LLM to be configured.
    const table: Array<[string, string, boolean, string]> = [
        ['llm', 'APPOINTMENTS', true, 'llm_agent'],
        ['llm', 'APPOINTMENTS', false, 'unavailable'],
        ['llm', 'RIDES', true, 'llm_agent'],
        ['llm', 'RIDES', false, 'unavailable'],
        ['flow', 'APPOINTMENTS', true, 'flow'],
        ['flow', 'APPOINTMENTS', false, 'flow'],
        ['flow', 'RIDES', true, 'flow'],
        ['flow', 'RIDES', false, 'flow'],
        ['external', 'APPOINTMENTS', true, 'external_app'],
        ['external', 'APPOINTMENTS', false, 'external_app'],
        ['external', 'RIDES', true, 'external_app'],
        ['external', 'RIDES', false, 'external_app'],
    ];
    it.each(table)('mode %s, vertical %s, llmEnabled %s -> %s', (mode, vertical, llm, expected) => {
        expect(selectConversationHandler(vertical, llm, mode)).toBe(expected);
    });

    it('an unknown mode fails safe to unavailable, never to the vertical default', () => {
        for (const mode of ['bot', 'FLOW', 'Llm', ' flow', 'external_app', '', 'null']) {
            expect(selectConversationHandler('APPOINTMENTS', true, mode)).toBe('unavailable');
            expect(selectConversationHandler('RIDES', true, mode)).toBe('unavailable');
        }
    });

    it('a valid override is honoured even for an unrecognised vertical', () => {
        expect(selectConversationHandler('TAXI_BOATS', true, 'external')).toBe('external_app');
        expect(selectConversationHandler('TAXI_BOATS', true, 'flow')).toBe('flow');
        expect(selectConversationHandler(null, false, 'flow')).toBe('flow');
    });

    it('null and undefined modes both mean "vertical default"', () => {
        expect(selectConversationHandler('RIDES', false, undefined)).toBe('flow');
        expect(selectConversationHandler('RIDES', false, null)).toBe('flow');
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

    it('a flow counts as an assistant, so a customer can resume into it', () => {
        expect(canCustomerResumeBot({ ...ok, handler: 'flow' })).toBe(true);
    });

    it('an external app decides for itself: the keyword never resumes the bot', () => {
        expect(canCustomerResumeBot({ ...ok, handler: 'external_app' })).toBe(false);
    });
});
