import { describe, it, expect, beforeEach } from 'vitest';
import { step, advance, newFlowState } from './engine.js';
import { parseFlowDefinition } from './validate.js';
import { registerFlowAction, resetFlowActionsForTests } from './actions.js';
import { registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../payment-fulfillers.js';
import { fakePorts, testMeta } from './testing.js';
import { validateField } from './validators.js';

const def = (raw: unknown) => {
    const r = parseFlowDefinition(raw);
    if (!r.ok) throw new Error(r.errors.join('; '));
    return r.definition;
};

let n = 0;
const msg = (text: string, extra: Record<string, unknown> = {}) => ({ inboundId: `m${++n}`, text, ...extra });

beforeEach(() => {
    n = 0;
    resetFlowActionsForTests(); resetPaymentFulfillersForTests();
    registerPaymentFulfiller('ride_package', async () => ({ status: 'applied' }));
});

const base = def({
    key: 'f', version: 1, start: 'menu',
    globals: { menu: { goto: 'menu' }, help: { goto: 'help' } },
    states: {
        menu: { type: 'menu', prompt: 'Main', options: [{ label: 'Name', next: 'name' }, { label: 'Pick', next: 'pick' }, { label: 'Loc', next: 'loc' }, { label: 'Sure', next: 'sure', set: { via: 'menu' } }] },
        name: { type: 'ask', prompt: 'Your name?', validate: 'name', var: 'full_name', next: 'hello' },
        hello: { type: 'notify', text: 'Hi {full_name}', next: 'fin' },
        pick: { type: 'choose', prompt: 'Where?', var: 'dest', items: [{ label: 'Campus', value: 'campus', attrs: { fare: '10' } }, { label: 'Mall', value: 'mall', attrs: { fare: '15' } }], next: 'fare' },
        fare: { type: 'notify', text: '{dest_label} costs {dest_fare}', next: 'fin' },
        loc: { type: 'location', prompt: 'Share location', var: 'pickup', fallback: [{ label: 'Main gate', latitude: 5.6, longitude: -0.18 }], next: 'locdone' },
        locdone: { type: 'notify', text: 'At {pickup} ({pickup_lat},{pickup_lng})', next: 'fin' },
        sure: { type: 'confirm', prompt: 'Sure?', yes: 'yes', no: 'menu' },
        yes: { type: 'notify', text: 'via {via}', next: 'fin' },
        help: { type: 'staff', text: 'Getting a human', queue: 'support', handoff: true },
        fin: { type: 'end', text: 'Done' },
    },
});

async function start() {
    const f = fakePorts();
    const r = await step(base, null, msg('hi'), f.ports, testMeta);
    return { f, r };
}

describe('step: start and menu', () => {
    it('shows the start menu numbered on first contact, ignoring the message content', async () => {
        const { r } = await start();
        expect(r.replies).toEqual(['Main\n\n1. Name\n2. Pick\n3. Loc\n4. Sure']);
        expect(r.state.current).toBe('menu');
        expect(r.handoff).toBeNull();
    });

    it('accepts number, label text and interactive id', async () => {
        const { f, r } = await start();
        for (const input of [msg('1'), msg(' name '), msg('', { interactiveId: '1' })]) {
            const r2 = await step(base, r.state, input, f.ports, testMeta);
            expect(r2.state.current).toBe('name');
        }
    });

    it('re-prompts invalid input and counts misses; valid input resets', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('banana'), f.ports, testMeta);
        expect(a.state.misses).toBe(1);
        expect(a.replies[0]).toMatch(/Main/);
        const b = await step(base, a.state, msg('2'), f.ports, testMeta);
        expect(b.state.misses).toBe(0);
    });

    it('hands off after 3 consecutive misses', async () => {
        const { f, r } = await start();
        let s = r.state;
        let last = r;
        for (let i = 0; i < 3; i++) { last = await step(base, s, msg('??'), f.ports, testMeta); s = last.state; }
        expect(last.handoff).toEqual({ reason: 'too_many_misses' });
        expect(last.state.status).toBe('handed_off');
        expect(last.effects).toContainEqual({ type: 'handoff', reason: 'too_many_misses' });
    });

    it('treats non-text input (location pin on a menu) as a miss', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, { inboundId: 'x1', location: { latitude: 1, longitude: 2 } }, f.ports, testMeta);
        expect(a.state.misses).toBe(1);
    });
});

describe('step: idempotency', () => {
    it('ignores a replayed inbound id', async () => {
        const { f, r } = await start();
        const input = msg('1');
        const a = await step(base, r.state, input, f.ports, testMeta);
        const b = await step(base, a.state, input, f.ports, testMeta);
        expect(b.replies).toEqual([]);
        expect(b.state).toEqual(a.state);
        expect(b.effects).toEqual([]);
    });

    it('does not re-fire side effects on replay (payment link created once)', async () => {
        const d = def({
            key: 'p', version: 1, start: 'p',
            states: { p: { type: 'payment', kind: 'ride_package', amount: 25, prompt: 'Pay {payment_url}', onSuccess: 'e' }, e: { type: 'end' } },
        });
        const f = fakePorts();
        const input = msg('go');
        const a = await step(d, null, input, f.ports, testMeta);
        await step(d, a.state, input, f.ports, testMeta);
        expect(f.calls.payments).toHaveLength(1);
    });
});

describe('step: global commands', () => {
    it('"menu" returns to start from anywhere, "help" goes to the help state and hands off', async () => {
        const { f, r } = await start();
        const inName = await step(base, r.state, msg('1'), f.ports, testMeta);
        expect(inName.state.current).toBe('name');
        const back = await step(base, inName.state, msg('MENU'), f.ports, testMeta);
        expect(back.state.current).toBe('menu');
        const help = await step(base, inName.state, msg('help'), f.ports, testMeta);
        expect(help.handoff?.reason).toBe('staff');
        expect(f.calls.staff[0]).toMatchObject({ queue: 'support' });
        expect(help.replies).toEqual(['Getting a human']);
    });
});

describe('step: ask', () => {
    it('stores a normalised value and moves on, chaining notify', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('1'), f.ports, testMeta);
        const b = await step(base, a.state, msg('  ama   mensah '), f.ports, testMeta);
        expect(b.state.vars.full_name).toBe('ama mensah');
        expect(b.replies).toEqual(['Hi ama mensah', 'Done']);
        expect(b.state.status).toBe('ended');
    });

    it('rejects an invalid name and keeps the step', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('1'), f.ports, testMeta);
        const b = await step(base, a.state, msg('12345'), f.ports, testMeta);
        expect(b.state.current).toBe('name');
        expect(b.state.vars.full_name).toBeUndefined();
        expect(b.state.misses).toBe(1);
    });

    it('restarts at the start state when a new message arrives after the flow ended', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('1'), f.ports, testMeta);
        const b = await step(base, a.state, msg('Ama'), f.ports, testMeta);
        const c = await step(base, b.state, msg('hello again'), f.ports, testMeta);
        expect(c.state.current).toBe('menu');
        expect(c.state.vars).toEqual({});
        expect(c.replies[0]).toMatch(/Main/);
    });

    it('with globalsOnOpen, an opening message that is a global command starts there (e.g. "Reply BOOK" after a finished flow)', async () => {
        const opted = def({ ...base, globalsOnOpen: true });
        const { f, r } = await start();
        const a = await step(opted, r.state, msg('1'), f.ports, testMeta);
        const ended = await step(opted, a.state, msg('Ama'), f.ports, testMeta);
        expect(ended.state.status).toBe('ended');
        const g = await step(opted, ended.state, msg('  HELP '), f.ports, testMeta);
        expect(g.replies[0]).toBe('Getting a human');
        expect(g.state.status).toBe('handed_off');
        // Brand-new conversation too.
        const fresh = await step(opted, null, msg('help'), f.ports, testMeta);
        expect(fresh.replies[0]).toBe('Getting a human');
        // Anything else still just shows the start state, uninterpreted.
        const other = await step(opted, ended.state, msg('1'), f.ports, testMeta);
        expect(other.state.current).toBe('menu');
        expect(other.replies[0]).toMatch(/^Main/);
    });

    it('without globalsOnOpen (the default) the opening message is never interpreted, even a global', async () => {
        const f = fakePorts();
        const fresh = await step(base, null, msg('help'), f.ports, testMeta);
        expect(fresh.replies[0]).toMatch(/^Main/);
        expect(fresh.state.status).toBe('active');
    });
});

describe('step: choose, location, confirm', () => {
    it('choose sets value, label and attributes', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('2'), f.ports, testMeta);
        expect(a.replies[0]).toBe('Where?\n\n1. Campus\n2. Mall');
        const bad = await step(base, a.state, msg('3'), f.ports, testMeta);
        expect(bad.state.misses).toBe(1);
        const b = await step(base, a.state, msg('mall'), f.ports, testMeta);
        expect(b.state.vars).toMatchObject({ dest: 'mall', dest_label: 'Mall', dest_fare: '15' });
        expect(b.replies[0]).toBe('Mall costs 15');
    });

    it('location accepts a pin, a numbered fallback, and rejects out-of-range coordinates', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('3'), f.ports, testMeta);
        expect(a.replies[0]).toBe('Share location\n\nOr reply with a number:\n1. Main gate');
        const pin = await step(base, a.state, { inboundId: 'p1', location: { latitude: 5.65, longitude: -0.19, name: 'Legon' } }, f.ports, testMeta);
        expect(pin.state.vars).toMatchObject({ pickup: 'Legon', pickup_lat: '5.65', pickup_lng: '-0.19' });
        const fb = await step(base, a.state, msg('1'), f.ports, testMeta);
        expect(fb.state.vars).toMatchObject({ pickup: 'Main gate', pickup_lat: '5.6' });
        const bad = await step(base, a.state, { inboundId: 'p2', location: { latitude: 95, longitude: 0 } }, f.ports, testMeta);
        expect(bad.state.misses).toBe(1);
        const nan = await step(base, a.state, { inboundId: 'p3', location: { latitude: NaN, longitude: 0 } }, f.ports, testMeta);
        expect(nan.state.misses).toBe(1);
    });

    it('location with acceptText also takes a typed answer (into <var>_text) and clears the other form', async () => {
        const d = def({
            key: 'lt', version: 1, start: 'dest',
            states: {
                dest: { type: 'location', prompt: 'Where to?', var: 'dest', acceptText: true, fallback: [{ label: 'Main gate', latitude: 5.6, longitude: -0.18 }], next: 'show' },
                show: { type: 'notify', text: '[{dest}] [{dest_text}] [{dest_lat}]', next: 'fin' },
                fin: { type: 'end' },
            },
        });
        const f = fakePorts();
        const r = await step(d, null, msg('hi'), f.ports, testMeta);
        expect(r.replies[0]).toBe('Where to?\n\nOr reply with a number:\n1. Main gate');

        // A fallback number still resolves to the fallback place.
        const fb = await step(d, r.state, msg('1'), f.ports, testMeta);
        expect(fb.state.vars).toMatchObject({ dest: 'Main gate', dest_lat: '5.6', dest_text: '' });

        // Any other text is accepted as typed, with the pin fields cleared.
        const typed = await step(d, { ...r.state, vars: { dest_lat: '1', dest_lng: '2', dest: 'old', dest_label: 'old' } }, msg('  2\n'), f.ports, testMeta);
        expect(typed.state.vars).toMatchObject({ dest_text: '2', dest: '', dest_label: '', dest_lat: '', dest_lng: '' });
        expect(typed.replies[0]).toBe('[] [2] []');

        // A pin clears a previously typed answer.
        const pin = await step(d, { ...r.state, vars: { dest_text: 'old' } }, { inboundId: 'pp', location: { latitude: 5.65, longitude: -0.19, name: 'Legon' } }, f.ports, testMeta);
        expect(pin.state.vars).toMatchObject({ dest: 'Legon', dest_lat: '5.65', dest_text: '' });

        // Empty / control-only text is still a miss; text is bounded.
        const empty = await step(d, r.state, msg('\u0000 '), f.ports, testMeta);
        expect(empty.state.misses).toBe(1);
        const long = await step(d, r.state, msg('x'.repeat(5000)), f.ports, testMeta);
        expect(long.state.vars.dest_text.length).toBe(200);
    });

    it('location without acceptText still rejects typed text (unchanged behaviour)', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('3'), f.ports, testMeta);
        const typed = await step(base, a.state, msg('the library'), f.ports, testMeta);
        expect(typed.state.misses).toBe(1);
        expect(typed.state.vars.pickup_text).toBeUndefined();
    });

    it('confirm routes yes and no, applies menu `set`', async () => {
        const { f, r } = await start();
        const a = await step(base, r.state, msg('4'), f.ports, testMeta);
        expect(a.state.vars.via).toBe('menu');
        const yes = await step(base, a.state, msg('Yes'), f.ports, testMeta);
        expect(yes.replies[0]).toBe('via menu');
        const no = await step(base, a.state, msg('no'), f.ports, testMeta);
        expect(no.state.current).toBe('menu');
        const maybe = await step(base, a.state, msg('maybe'), f.ports, testMeta);
        expect(maybe.state.misses).toBe(1);
    });
});

describe('step: payment, action, branch, staff', () => {
    const mkD = () => def({
        key: 'p', version: 1, start: 'ask_amt',
        states: {
            ask_amt: { type: 'ask', prompt: 'Amount?', validate: 'free', var: 'amt', next: 'pay' },
            pay: { type: 'payment', kind: 'ride_package', amountVar: 'amt', prompt: 'Pay {payment_url}', waitingText: 'Still waiting', produces: ['rides'], onSuccess: 'ok', onFailure: 'bad' },
            ok: { type: 'notify', text: 'Paid, {rides} rides', next: 'bal' },
            bal: { type: 'action', action: 'bal', args: { who: '{customer_phone}' }, produces: ['left'], next: 'show', onError: 'bad' },
            show: { type: 'branch', cases: [{ when: { var: 'left', op: 'gt', value: '0' }, next: 'some' }], default: 'none' },
            some: { type: 'staff', text: 'Dispatching', queue: 'dispatch', next: 'fin' },
            none: { type: 'end', text: 'No rides' },
            bad: { type: 'end', text: 'Payment problem' },
            fin: { type: 'end', text: 'Fin' },
        },
    });

    let d: ReturnType<typeof mkD>;
    beforeEach(() => { registerFlowAction('bal', async () => ({ ok: true })); d = mkD(); });

    it('creates a link from a variable amount, waits, ignores chatter without counting misses', async () => {
        const f = fakePorts();
        const a = await step(d, null, msg('x'), f.ports, testMeta);
        const b = await step(d, a.state, msg('25.50'), f.ports, testMeta);
        expect(f.calls.payments[0]).toMatchObject({ kind: 'ride_package', amount: 25.5, currency: 'GHS', tenantId: 't1', conversationId: 'c1' });
        expect(f.calls.payments[0].idempotencyKey).toContain('pay');
        expect(b.replies).toEqual(['Pay https://pay.test/ride_package/1']);
        expect(b.state.status).toBe('waiting');
        const c = await step(d, b.state, msg('hello?'), f.ports, testMeta);
        expect(c.replies).toEqual(['Still waiting']);
        expect(c.state.misses).toBe(0);
        expect(c.state.status).toBe('waiting');
    });

    it('a non-numeric or non-positive amount variable fails the step safely (no link)', async () => {
        const f = fakePorts();
        const a = await step(d, null, msg('x'), f.ports, testMeta);
        const b = await step(d, a.state, msg('abc'), f.ports, testMeta);
        expect(f.calls.payments).toHaveLength(0);
        expect(b.replies.at(-1)).toBe('Payment problem');
    });

    it('link creation returning null goes to onFailure; throwing does too', async () => {
        for (const mode of ['null', 'throw']) {
            const f = fakePorts();
            f.ports.createPaymentLink = async () => { if (mode === 'throw') throw new Error('boom'); return null; };
            const a = await step(d, null, msg('x'), f.ports, testMeta);
            const b = await step(d, a.state, msg('10'), f.ports, testMeta);
            expect(b.replies.at(-1)).toBe('Payment problem');
        }
    });

    it('advance: payment.succeeded moves on, runs the action, branches and queues staff', async () => {
        const f = fakePorts({ actions: { bal: () => ({ ok: true, vars: { left: '3', evil: 'x' } }) } });
        const a = await step(d, null, msg('x'), f.ports, testMeta);
        const b = await step(d, a.state, msg('10'), f.ports, testMeta);
        const r = await advance(d, b.state, { type: 'payment.succeeded', eventId: 'e1', vars: { rides: '5', other: 'no' } }, f.ports, testMeta);
        expect(r.applied).toBe(true);
        expect(r.replies).toEqual(['Paid, 5 rides', 'Dispatching', 'Fin']);
        expect(r.state.vars.evil).toBeUndefined();
        expect(r.state.vars.other).toBeUndefined();
        expect(f.calls.actions[0]).toMatchObject({ name: 'bal', args: { who: '+233241234567' } });
        expect(f.calls.staff[0]).toMatchObject({ queue: 'dispatch' });
        // replay of the same event does nothing
        const again = await advance(d, r.state, { type: 'payment.succeeded', eventId: 'e1' }, f.ports, testMeta);
        expect(again.applied).toBe(false);
        expect(again.replies).toEqual([]);
    });

    it('advance: payment.failed takes onFailure; wrong kind or non-waiting state is ignored', async () => {
        const f = fakePorts();
        const a = await step(d, null, msg('x'), f.ports, testMeta);
        const b = await step(d, a.state, msg('10'), f.ports, testMeta);
        const wrong = await advance(d, b.state, { type: 'payment.succeeded', kind: 'other_kind' }, f.ports, testMeta);
        expect(wrong.applied).toBe(false);
        const notWaiting = await advance(d, a.state, { type: 'payment.succeeded' }, f.ports, testMeta);
        expect(notWaiting.applied).toBe(false);
        const none = await advance(d, null, { type: 'payment.succeeded' }, f.ports, testMeta);
        expect(none.applied).toBe(false);
        const failed = await advance(d, b.state, { type: 'payment.failed' }, f.ports, testMeta);
        expect(failed.replies).toEqual(['Payment problem']);
    });

    it('action failure (ok:false or throw) takes onError; branch default is used', async () => {
        const f = fakePorts({ actions: { bal: () => ({ ok: true, vars: { left: '0' } }) } });
        const a = await step(d, null, msg('x'), f.ports, testMeta);
        const b = await step(d, a.state, msg('10'), f.ports, testMeta);
        const r = await advance(d, b.state, { type: 'payment.succeeded' }, f.ports, testMeta);
        expect(r.replies.at(-1)).toBe('No rides');

        const f2 = fakePorts();
        f2.ports.runAction = async () => { throw new Error('x'); };
        const b2 = await step(d, (await step(d, null, msg('x'), f2.ports, testMeta)).state, msg('10'), f2.ports, testMeta);
        const r2 = await advance(d, b2.state, { type: 'payment.succeeded' }, f2.ports, testMeta);
        expect(r2.replies.at(-1)).toBe('Payment problem');
    });

    it('a failing staff queue still hands the conversation to a human, loudly', async () => {
        const hd = def({ key: 's', version: 1, start: 's', states: { s: { type: 'staff', text: 'Hold on', queue: 'q', handoff: true } } });
        const f = fakePorts({ failStaff: true });
        const r = await step(hd, null, msg('x'), f.ports, testMeta);
        expect(r.handoff).not.toBeNull();
        expect(r.effects).toContainEqual({ type: 'staff_queue_failed', queue: 'q' });
    });

    it('a loop of automatic steps is cut off with a handoff', async () => {
        const loop = def({ key: 'l', version: 1, start: 'a', states: { a: { type: 'notify', text: 'x', next: 'b' }, b: { type: 'notify', text: 'y', next: 'a' } } });
        const r = await step(loop, null, msg('x'), fakePorts().ports, testMeta);
        expect(r.handoff).toEqual({ reason: 'flow_loop' });
        expect(r.replies.length).toBeLessThanOrEqual(31);
    });
});

describe('step: state hygiene', () => {
    it('does not mutate the input state', async () => {
        const { f, r } = await start();
        const frozen = JSON.stringify(r.state);
        await step(base, r.state, msg('1'), f.ports, testMeta);
        expect(JSON.stringify(r.state)).toBe(frozen);
    });

    it('restarts when the stored state is for another flow version or an unknown state', async () => {
        const f = fakePorts();
        const stale = { ...newFlowState(base), flowVersion: 99, current: 'name' };
        const r = await step(base, stale, msg('x'), f.ports, testMeta);
        expect(r.state.current).toBe('menu');
        const ghost = { ...newFlowState(base), current: 'ghost' };
        expect((await step(base, ghost, msg('x'), f.ports, testMeta)).state.current).toBe('menu');
    });
});

describe('validateField', () => {
    it.each([
        ['name', 'Ama Mensah', 'Ama Mensah'], ['name', "Kofi O'Neil-Smith", "Kofi O'Neil-Smith"], ['name', 'Zoë Müller', 'Zoë Müller'],
        ['email', ' A@B.com ', 'a@b.com'],
        ['phone', '0241234567', '+233241234567'], ['phone', '024 123 4567', '+233241234567'], ['phone', '233241234567', '+233241234567'],
        ['phone', '+233 24-123-4567', '+233241234567'], ['phone', '+14155552671', '+14155552671'],
        ['free', '  anything goes ', 'anything goes'],
    ])('%s accepts %j', (kind, input, out) => {
        expect(validateField({ validate: kind as any }, input)).toEqual({ ok: true, value: out });
    });

    it.each([
        ['name', ''], ['name', 'A'], ['name', '12345'], ['name', 'x'.repeat(100)], ['name', 'Robert<script>'], ['name', "Bob'); DROP TABLE"],
        ['email', 'nope'], ['email', 'a@b'], ['email', 'a b@c.com'], ['email', `${'a'.repeat(250)}@b.com`],
        ['phone', '12345'], ['phone', 'abcdefghij'], ['phone', '+0123456789'], ['phone', '024123456'], ['phone', '+1234567890123456'],
        ['free', ''], ['free', '   '], ['free', 'x'.repeat(501)],
        ['studentId', 'ab'],
    ])('%s rejects %j', (kind, input) => {
        expect(validateField({ validate: kind as any }, input).ok).toBe(false);
    });

    it('studentId uses a custom pattern and strips control characters', () => {
        expect(validateField({ validate: 'studentId', pattern: '^\\d{8}$' }, '12345678').ok).toBe(true);
        expect(validateField({ validate: 'studentId', pattern: '^\\d{8}$' }, '1234567').ok).toBe(false);
        expect(validateField({ validate: 'studentId' }, 'UG/2021-0042')).toEqual({ ok: true, value: 'UG/2021-0042' });
        expect(validateField({ validate: 'free' }, 'a\u0000b\u0007c')).toEqual({ ok: true, value: 'abc' });
    });

    it('free accepts emoji and unicode', () => {
        expect(validateField({ validate: 'free' }, 'Légon 🎓')).toEqual({ ok: true, value: 'Légon 🎓' });
    });
});

describe('advance: the event must be for THIS payment link', () => {
    const payDef = () => def({
        key: 'q', version: 1, start: 'pay', globals: { menu: { goto: 'pay' } },
        states: {
            pay: { type: 'payment', kind: 'ride_package', amount: 25, prompt: 'Pay {payment_url}', waitingText: 'Still waiting', onSuccess: 'ok', onFailure: 'bad' },
            ok: { type: 'end', text: 'Paid' },
            bad: { type: 'end', text: 'Failed' },
        },
    });
    const waiting = async (ref = 'ref_1') => {
        const f = fakePorts({ paymentLink: () => ({ url: 'https://pay.test/a', reference: ref }) });
        const r = await step(payDef(), null, msg('hi'), f.ports, testMeta);
        return { f, state: r.state };
    };

    it('ignores a succeeded event whose reference is not the waiting step link', async () => {
        const { f, state } = await waiting('ref_new');
        const r = await advance(payDef(), state, { type: 'payment.succeeded', eventId: 'ref_old', reference: 'ref_old', amountMinor: 2500, currency: 'GHS' }, f.ports, testMeta);
        expect(r.applied).toBe(false);
        expect(r.state.status).toBe('waiting');
    });

    it('ignores a failed event for another link too', async () => {
        const { f, state } = await waiting('ref_new');
        const r = await advance(payDef(), state, { type: 'payment.failed', eventId: 'ref_old', reference: 'ref_old' }, f.ports, testMeta);
        expect(r.applied).toBe(false);
    });

    it('applies when the reference matches', async () => {
        const { f, state } = await waiting('ref_1');
        const r = await advance(payDef(), state, { type: 'payment.succeeded', eventId: 'ref_1', reference: 'ref_1', amountMinor: 2500, currency: 'GHS' }, f.ports, testMeta);
        expect(r.applied).toBe(true);
        expect(r.replies).toEqual(['Paid']);
    });

    it('rejects an amount below the CURRENT step amount even when no reference was recorded', async () => {
        const { f, state } = await waiting('');
        const r = await advance(payDef(), state, { type: 'payment.succeeded', eventId: 'x', reference: 'x', amountMinor: 1000, currency: 'GHS' }, f.ports, testMeta);
        expect(r.applied).toBe(false);
    });

    it('rejects a different currency, tolerates one minor unit of rounding', async () => {
        const { f, state } = await waiting('ref_1');
        const usd = await advance(payDef(), state, { type: 'payment.succeeded', eventId: 'ref_1', reference: 'ref_1', amountMinor: 2500, currency: 'USD' }, f.ports, testMeta);
        expect(usd.applied).toBe(false);
        const near = await advance(payDef(), state, { type: 'payment.succeeded', eventId: 'ref_1', reference: 'ref_1', amountMinor: 2499, currency: 'GHS' }, f.ports, testMeta);
        expect(near.applied).toBe(true);
    });

    it('an amount that cannot be determined (amountVar unset) is a mismatch, never a success', async () => {
        const d = def({
            key: 'q', version: 1, start: 'ask_amt',
            states: {
                ask_amt: { type: 'ask', prompt: 'Amount?', validate: 'free', var: 'amt', next: 'pay' },
                pay: { type: 'payment', kind: 'ride_package', amountVar: 'amt', prompt: 'Pay {payment_url}', waitingText: 'Still waiting', onSuccess: 'ok', onFailure: 'bad' },
                ok: { type: 'end', text: 'Paid' },
                bad: { type: 'end', text: 'Failed' },
            },
        });
        const f = fakePorts({ paymentLink: () => ({ url: 'https://pay.test/a', reference: 'ref_1' }) });
        const r1 = await step(d, null, msg('hi'), f.ports, testMeta);
        const r0 = await step(d, r1.state, msg('25'), f.ports, testMeta);
        expect(r0.state.status).toBe('waiting');
        // The amount variable is gone / unusable by the time the money arrives.
        const lost = { ...r0.state, vars: { ...r0.state.vars, amt: 'not a number' } };
        const r = await advance(d, lost, { type: 'payment.succeeded', eventId: 'ref_1', reference: 'ref_1', amountMinor: 2500, currency: 'GHS' }, f.ports, testMeta);
        expect(r.applied).toBe(false);
        expect(r.state.status).toBe('waiting');
    });

    it('events without a reference keep the old behaviour (backwards compatible)', async () => {
        const { f, state } = await waiting('ref_1');
        const r = await advance(payDef(), state, { type: 'payment.succeeded', eventId: 'e' }, f.ports, testMeta);
        expect(r.applied).toBe(true);
    });
});

describe('waiting on a payment: menu reminder', () => {
    const d0 = () => def({
        key: 'w', version: 1, start: 'pay', globals: { menu: { goto: 'pay' } },
        states: { pay: { type: 'payment', kind: 'kk', amount: 5, prompt: 'Pay {payment_url}', waitingText: 'Still waiting', onSuccess: 'ok' }, ok: { type: 'end' } },
    });
    const noMenu0 = () => def({
        key: 'w2', version: 1, start: 'pay',
        states: { pay: { type: 'payment', kind: 'kk', amount: 5, prompt: 'Pay {payment_url}', waitingText: 'Still waiting', onSuccess: 'ok' }, ok: { type: 'end' } },
    });

    let d: ReturnType<typeof d0>; let noMenu: ReturnType<typeof noMenu0>;
    beforeEach(() => { registerPaymentFulfiller('kk', async () => ({ status: 'applied' })); d = d0(); noMenu = noMenu0(); });

    it('reminds about "menu" on every third chatter message, without changing the step', async () => {
        const f = fakePorts();
        let s = (await step(d, null, msg('hi'), f.ports, testMeta)).state;
        const replies: string[] = [];
        for (let i = 0; i < 6; i++) {
            const r = await step(d, s, msg('hello'), f.ports, testMeta);
            replies.push(r.replies.join('|'));
            s = r.state;
            expect(s.status).toBe('waiting');
            expect(s.current).toBe('pay');
        }
        expect(replies[0]).toBe('Still waiting');
        expect(replies[1]).toBe('Still waiting');
        expect(replies[2]).toMatch(/Still waiting[\s\S]*menu/i);
        expect(replies[3]).toBe('Still waiting');
        expect(replies[5]).toMatch(/menu/i);
    });

    it('never mentions a menu command the flow does not have', async () => {
        const f = fakePorts();
        let s = (await step(noMenu, null, msg('hi'), f.ports, testMeta)).state;
        for (let i = 0; i < 4; i++) {
            const r = await step(noMenu, s, msg('hello'), f.ports, testMeta);
            expect(r.replies).toEqual(['Still waiting']);
            s = r.state;
        }
    });
});

describe('flow completion', () => {
    beforeEach(() => { registerPaymentFulfiller('kk', async () => ({ status: 'applied' })); });
    const d0 = () => def({
        key: 'done', version: 2, start: 'menu',
        states: {
            menu: { type: 'menu', prompt: 'Pick', options: [{ label: 'Go', next: 'name', set: { plan: 'gold' } }] },
            name: { type: 'ask', prompt: 'Name?', validate: 'name', var: 'full_name', next: 'where' },
            where: { type: 'choose', prompt: 'Where?', var: 'dest', items: [{ label: 'Campus', value: 'campus', attrs: { fare: '10' } }], next: 'pay' },
            pay: { type: 'payment', kind: 'kk', amount: 5, prompt: 'Pay {payment_url}', onSuccess: 'fin' },
            fin: { type: 'end', text: 'Bye' },
        },
    });

    let d: ReturnType<typeof d0>;
    beforeEach(() => { d = d0(); });

    it('reports completion with only allowlisted vars (no ask answers, no payment link or reference, no phone)', async () => {
        const f = fakePorts();
        let s = (await step(d, null, msg('hi'), f.ports, testMeta)).state;
        s = (await step(d, s, msg('1'), f.ports, testMeta)).state;
        s = (await step(d, s, msg('Kofi Mensah'), f.ports, testMeta)).state;
        const waiting = await step(d, s, msg('1'), f.ports, testMeta);
        expect(waiting.completed).toBeNull();
        const done = await advance(d, waiting.state, { type: 'payment.succeeded', eventId: 'e' }, f.ports, testMeta);
        expect(done.state.status).toBe('ended');
        expect(done.completed).toEqual({ flowKey: 'done', version: 2, vars: { plan: 'gold', dest: 'campus', dest_label: 'Campus', dest_fare: '10' } });
    });

    it('is null for a hand-off, a miss and a replay', async () => {
        const f = fakePorts();
        const a = await step(d, null, msg('hi'), f.ports, testMeta);
        const miss = await step(d, a.state, msg('??'), f.ports, testMeta);
        expect(a.completed).toBeNull();
        expect(miss.completed).toBeNull();
    });

    it('reports completion when a staff step with no next ends the flow', async () => {
        const s = def({ key: 's', version: 1, start: 'st', states: { st: { type: 'staff', text: 'Queued', queue: 'q' } } });
        const f = fakePorts();
        const r = await step(s, null, msg('hi'), f.ports, testMeta);
        expect(r.completed).toEqual({ flowKey: 's', version: 1, vars: {} });
    });
});
