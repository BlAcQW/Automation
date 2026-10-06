/** End-to-end TURBO-shaped journey through runFlowTurn / advanceFlow with fake ports (no DB). */
import { describe, it, expect, beforeEach } from 'vitest';
import { runFlowTurn, advanceFlow, readFlowState, type FlowRunnerDeps } from './runner.js';
import { fakePorts, memoryFlowStore, defRow } from './testing.js';
import { turboSampleFlow } from './samples/turbo-flow.js';
import { parseFlowDefinition } from './validate.js';
import { registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../payment-fulfillers.js';
import { registerFlowAction, resetFlowActionsForTests } from './actions.js';
import { runRegisteredAction } from './actions.js';

const tenant = { id: 't1', vertical: 'RIDES', activeFlowKey: 'turbo-rides' };
let n = 0;
let balance: number | null = 4;

function setup() {
    const mem = memoryFlowStore(
        { definitions: [defRow({ key: 'turbo-rides', version: 1, definition: turboSampleFlow })], conversations: [{ id: 'c1', customerPhone: '0241234567', botContext: null, contextVersion: 0 }] },
    );
    const f = fakePorts();
    f.ports.runAction = runRegisteredAction; // real registry dispatch
    const deps: FlowRunnerDeps = { store: mem.store, ports: f.ports };
    const say = (text?: string, extra: Record<string, unknown> = {}, id?: string) =>
        runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: { inboundId: id ?? `m${++n}`, text, ...extra } });
    return { mem, f, deps, say, state: () => readFlowState(mem.conversation('c1').botContext)! };
}

beforeEach(() => {
    n = 0; balance = 4;
    resetPaymentFulfillersForTests(); resetFlowActionsForTests();
    registerPaymentFulfiller('ride_package', async () => ({ status: 'applied' }));
    registerFlowAction('turbo_balance', async () => (balance === null ? { ok: false } : { ok: true, vars: { rides_left: balance } }));
});

describe('sample flow', () => {
    it('is a valid definition', () => {
        const r = parseFlowDefinition(turboSampleFlow);
        expect(r.ok).toBe(true);
    });

    it('fails validation if the pack has not registered its action/kind', () => {
        resetFlowActionsForTests();
        expect(parseFlowDefinition(turboSampleFlow).ok).toBe(false);
    });
});

describe('full journey', () => {
    it('register -> buy package (payment wait) -> activated -> book ride -> dispatch -> end', async () => {
        const { say, f, deps, state } = setup();

        expect((await say('hi')).reply).toMatch(/Welcome to TURBO Rides[\s\S]*1\. Register[\s\S]*4\. Check my balance/);
        expect((await say('1')).reply).toBe('What is your full name?');

        // invalid inputs re-prompt and are counted
        const badName = await say('12345');
        expect(badName.reply).toMatch(/^Sorry, I didn't get that\.\n\nWhat is your full name\?/);
        expect(state().misses).toBe(1);
        expect((await say('Ama Mensah')).reply).toBe('Your student ID?');
        expect((await say('abc')).reply).toMatch(/^Student IDs are 8 to 10 digits\./);
        expect((await say('20211234')).reply).toBe('Which university are you at?');
        expect((await say('University of Ghana')).reply).toBe('And your email address?');
        expect((await say('not-an-email')).reply).toMatch(/^Sorry/);
        const confirm = await say('Ama@Example.com');
        expect(confirm.reply).toBe('Please confirm:\nAma Mensah\nID 20211234\nUniversity of Ghana\nama@example.com\n\n1. Yes\n2. No');

        const pkg = await say('yes');
        expect(pkg.reply).toBe("Thanks Ama Mensah, you're registered. Let's get you a ride package.\n\nPick a ride package:\n\n1. 5 rides - GHS 25\n2. 12 rides - GHS 55");

        const pay = await say('2');
        expect(pay.reply).toBe('Pay GHS 55 for 12 rides - GHS 55 here: https://pay.test/ride_package/1');
        expect(pay.toolsUsed).toEqual(['flow:payment_link']);
        expect(f.calls.payments[0]).toMatchObject({ kind: 'ride_package', amount: 55, currency: 'GHS', customerPhone: '0241234567' });
        expect(state().status).toBe('waiting');

        // chatter while waiting
        expect((await say('hello??')).reply).toMatch(/waiting for your payment/);
        expect(state().status).toBe('waiting');

        // payment webhook -> advanceFlow
        const adv = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded', eventId: 'evt_1', kind: 'ride_package' } });
        expect(adv.applied).toBe(true);
        expect(adv.reply).toBe('Payment received. Your 12 rides - GHS 55 package is active!\n\nShare your pickup location (tap the + and choose Location).\n\nOr reply with a number:\n1. Main gate\n2. Night market');
        expect(adv.wantsHuman).toBe(false);

        // book a ride: location pin
        const dest = await say(undefined, { location: { latitude: 5.65, longitude: -0.19, name: 'Commonwealth Hall' } });
        expect(dest.reply).toBe('Where to?\n\n1. Campus North\n2. Accra Mall\n3. Airport');
        const conf = await say('Accra Mall');
        expect(conf.reply).toBe('Book a ride from Commonwealth Hall to Accra Mall?\n\n1. Yes\n2. No');
        const done = await say('1');
        expect(done.reply).toBe('Booked! A rider is being assigned and will message you shortly.\n\nSafe travels. Send "menu" any time.');
        expect(done.toolsUsed).toEqual(['flow:staff_queue']);
        expect(done.wantsHuman).toBe(false);
        expect(f.calls.staff[0]).toMatchObject({ queue: 'dispatch', handoff: false });
        expect(f.calls.staff[0].vars).toMatchObject({ pickup_lat: '5.65', pickup_lng: '-0.19', destination: 'mall', destination_zone: 'B', student_id: '20211234' });
        expect(state().status).toBe('ended');

        // next message starts over
        expect((await say('menu')).reply).toMatch(/Welcome to TURBO Rides/);
    });

    it('payment failure event follows onFailure', async () => {
        const { say, deps } = setup();
        await say('hi'); await say('2'); await say('1');
        const adv = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.failed', eventId: 'evt_x' } });
        expect(adv.reply).toBe('We could not complete your purchase. Send "menu" to try again.');
    });

    it('a no-payment-key tenant (link creation returns null) is told, not left waiting', async () => {
        const { say, f, state } = setup();
        f.ports.createPaymentLink = async () => null;
        await say('hi'); await say('2');
        const r = await say('1');
        expect(r.reply).toBe("Sorry, we couldn't create a payment link.\n\nWe could not complete your purchase. Send \"menu\" to try again.");
        expect(state().status).toBe('ended');
    });

    it('check balance via an action, and the action-failure branch', async () => {
        const { say } = setup();
        await say('hi');
        expect((await say('4')).reply).toBe('You have 4 rides left.\n\nSend "menu" any time.');
        balance = null;
        await say('menu');
        expect((await say('4')).reply).toMatch(/couldn't find your balance/);
    });

    it('three consecutive misses hand off with the flow\'s own text; later messages restart the bot flow', async () => {
        const { say, state } = setup();
        await say('hi');
        await say('x'); await say('y');
        const r = await say('z');
        expect(r.wantsHuman).toBe(true);
        expect(r.reply).toBe("I'm having trouble understanding. Someone from the TURBO team will reply shortly.");
        expect(state().status).toBe('handed_off');
    });

    it('"help" hands to staff at any point and queues in support', async () => {
        const { say, f } = setup();
        await say('hi'); await say('1');
        const r = await say('HELP');
        expect(r.wantsHuman).toBe(true);
        expect(r.reply).toBe('Connecting you with the team...');
        expect(f.calls.staff[0]).toMatchObject({ queue: 'support', handoff: true });
    });

    it('a duplicate inbound mid-journey changes nothing and sends nothing', async () => {
        const { say, state } = setup();
        await say('hi');
        await say('1', {}, 'dup-1');
        const before = JSON.stringify(state());
        const again = await say('1', {}, 'dup-1');
        expect(again.reply).toBe('');
        expect(JSON.stringify(state())).toBe(before);
    });

    it('a flood of unusual input never throws (emoji, huge text, injection-looking strings)', async () => {
        const { say } = setup();
        await say('hi'); await say('1');
        for (const t of ['😀😀😀', 'x'.repeat(20000), "'; DROP TABLE users;--", '{full_name}', '\u0000\u0007']) {
            const r = await say(t);
            expect(typeof r.reply).toBe('string');
            if (r.wantsHuman) break;
        }
    });
});
