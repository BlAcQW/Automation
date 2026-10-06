import { describe, it, expect, beforeEach } from 'vitest';
import { parseFlowDefinition } from './validate.js';
import { registerFlowAction, resetFlowActionsForTests } from './actions.js';
import { registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../payment-fulfillers.js';

const ok = async () => ({ status: 'applied' as const });

function base(over: Record<string, unknown> = {}) {
    return {
        key: 'f', version: 1, start: 'menu',
        states: {
            menu: { type: 'menu', prompt: 'Hi', options: [{ label: 'A', next: 'done' }] },
            done: { type: 'end', text: 'Bye' },
        },
        ...over,
    };
}

beforeEach(() => { resetFlowActionsForTests(); resetPaymentFulfillersForTests(); });

describe('parseFlowDefinition', () => {
    it('accepts a minimal flow', () => {
        const r = parseFlowDefinition(base());
        expect(r.ok).toBe(true);
    });

    it.each([null, undefined, 'x', 5, [], {}])('rejects non-definition %j', (v) => {
        expect(parseFlowDefinition(v).ok).toBe(false);
    });

    it('rejects a missing start state', () => {
        const r = parseFlowDefinition(base({ start: 'nope' }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors.join()).toMatch(/start/);
    });

    it('rejects transitions to unknown states', () => {
        const r = parseFlowDefinition(base({ states: { menu: { type: 'menu', prompt: 'x', options: [{ label: 'A', next: 'ghost' }] } } }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors.join()).toMatch(/ghost/);
    });

    it('rejects unknown step types and menus with no options or over 10', () => {
        expect(parseFlowDefinition(base({ states: { menu: { type: 'wat' } } })).ok).toBe(false);
        expect(parseFlowDefinition(base({ states: { menu: { type: 'menu', prompt: 'x', options: [] } } })).ok).toBe(false);
        const many = Array.from({ length: 11 }, (_, i) => ({ label: `o${i}`, next: 'menu' }));
        expect(parseFlowDefinition(base({ states: { menu: { type: 'menu', prompt: 'x', options: many } } })).ok).toBe(false);
    });

    it('rejects unknown variables in copy but allows ones a step defines', () => {
        const bad = parseFlowDefinition(base({
            states: { menu: { type: 'menu', prompt: 'Hi {who}', options: [{ label: 'A', next: 'done' }] }, done: { type: 'end' } },
        }));
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.errors.join()).toMatch(/who/);

        const good = parseFlowDefinition(base({
            start: 'n',
            states: {
                n: { type: 'ask', prompt: 'Name?', validate: 'name', var: 'who', next: 'done' },
                done: { type: 'end', text: 'Bye {who} on {customer_phone}' },
            },
        }));
        expect(good.ok).toBe(true);
    });

    it('rejects invalid variable names and bad regex patterns', () => {
        const badVar = parseFlowDefinition(base({ start: 'n', states: { n: { type: 'ask', prompt: 'x', validate: 'free', var: 'Bad-Name', next: 'n' } } }));
        expect(badVar.ok).toBe(false);
        const badRe = parseFlowDefinition(base({ start: 'n', states: { n: { type: 'ask', prompt: 'x', validate: 'studentId', pattern: '([', var: 'v', next: 'n' } } }));
        expect(badRe.ok).toBe(false);
    });

    it('requires a registered, non-reserved action', () => {
        const def = base({
            start: 'a',
            states: { a: { type: 'action', action: 'turbo_balance', next: 'e' }, e: { type: 'end' } },
        });
        expect(parseFlowDefinition(def).ok).toBe(false);
        registerFlowAction('turbo_balance', async () => ({ ok: true }));
        expect(parseFlowDefinition(def).ok).toBe(true);
    });

    it('requires a registered fulfillment kind for payment steps and {payment_url} in the prompt', () => {
        const pay = (prompt: string) => base({
            start: 'p',
            states: { p: { type: 'payment', kind: 'ride_package', amount: 25, prompt, onSuccess: 'e' }, e: { type: 'end' } },
        });
        expect(parseFlowDefinition(pay('Pay {payment_url}')).ok).toBe(false); // kind not registered
        registerPaymentFulfiller('ride_package', ok);
        expect(parseFlowDefinition(pay('Pay {payment_url}')).ok).toBe(true);
        expect(parseFlowDefinition(pay('Pay please')).ok).toBe(false);
        expect(parseFlowDefinition(pay('Pay {payment_url}'), { checkPaymentKinds: false }).ok).toBe(true);
    });

    it('payment needs exactly one of amount / amountVar, positive', () => {
        registerPaymentFulfiller('ride_package', ok);
        const mk = (extra: Record<string, unknown>) => base({
            start: 'p',
            states: { p: { type: 'payment', kind: 'ride_package', prompt: '{payment_url}', onSuccess: 'e', ...extra }, e: { type: 'end' } },
        });
        expect(parseFlowDefinition(mk({})).ok).toBe(false);
        expect(parseFlowDefinition(mk({ amount: 0 })).ok).toBe(false);
        expect(parseFlowDefinition(mk({ amount: -3 })).ok).toBe(false);
        expect(parseFlowDefinition(mk({ amount: 5, amountVar: 'x' })).ok).toBe(false);
    });

    it('rejects globals pointing nowhere', () => {
        expect(parseFlowDefinition(base({ globals: { menu: { goto: 'ghost' } } })).ok).toBe(false);
        expect(parseFlowDefinition(base({ globals: { menu: { goto: 'menu' } } })).ok).toBe(true);
    });

    it('rejects branch steps with unknown targets', () => {
        const r = parseFlowDefinition(base({
            start: 'b',
            states: { b: { type: 'branch', cases: [{ when: { var: 'x', op: 'eq', value: '1' }, next: 'e' }], default: 'ghost' }, e: { type: 'end' } },
        }));
        expect(r.ok).toBe(false);
    });
});

describe('action registry', () => {
    it('refuses reserved, malformed and duplicate names', () => {
        expect(() => registerFlowAction('handoff', async () => ({ ok: true }))).toThrow(/reserved/);
        expect(() => registerFlowAction('bookly.anything', async () => ({ ok: true }))).toThrow(/reserved/);
        expect(() => registerFlowAction('Bad Name', async () => ({ ok: true }))).toThrow(/Invalid/);
        registerFlowAction('turbo_x', async () => ({ ok: true }));
        expect(() => registerFlowAction('turbo_x', async () => ({ ok: true }))).toThrow(/already/);
    });
});

describe('location acceptText', () => {
    const withLoc = (loc: Record<string, unknown>, text: string) => base({
        start: 'loc',
        states: {
            loc: { type: 'location', prompt: 'Where?', var: 'dest', next: 'show', ...loc },
            show: { type: 'notify', text, next: 'done' },
            done: { type: 'end' },
        },
    });

    it('makes <var>_text a known variable only when acceptText is on', () => {
        expect(parseFlowDefinition(withLoc({ acceptText: true }, 'You typed {dest_text}')).ok).toBe(true);
        const off = parseFlowDefinition(withLoc({}, 'You typed {dest_text}'));
        expect(off.ok).toBe(false);
        if (!off.ok) expect(off.errors.join(';')).toMatch(/unknown variable \{dest_text\}/);
    });

    it('stays strict: acceptText must be a boolean', () => {
        expect(parseFlowDefinition(withLoc({ acceptText: 'yes' }, 'x')).ok).toBe(false);
    });
});
