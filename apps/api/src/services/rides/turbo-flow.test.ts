/**
 * The "turbo-founding" definition driven through the real runner and engine
 * with fake actions (no database). Proves TURBO's wording, both menus, the
 * purchase / booking / PAYG paths and the BOOK keyword. The same journey on a
 * real database, with the real actions and fulfillers, is
 * test/db/rides-journey.dbtest.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runFlowTurn, advanceFlow, readFlowState, type FlowRunnerDeps } from '../flows/runner.js';
import { parseFlowDefinition } from '../flows/validate.js';
import { fakePorts, memoryFlowStore, defRow } from '../flows/testing.js';
import { registerFlowAction, resetFlowActionsForTests, runRegisteredAction } from '../flows/actions.js';
import { registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../payment-fulfillers.js';
import type { ActionRequest } from '../flows/engine.js';
import { turboFoundingFlow } from './turbo-flow.js';
import { TURBO_ACTIONS, withPlaceMisses } from './flow-actions.js';

type Vars = Record<string, string | number>;
let state: { member: boolean; payg: 'open' | 'closed' | 'full'; openRide: boolean; quoteOk: boolean | 'unknown'; calls: ActionRequest[] };

const fakes: Record<string, (req: ActionRequest) => Vars> = {
    'turbo.balance': () => ({
        member: state.member ? 'yes' : 'no', pass_name: 'Pioneer 50', rides_total: 60, rides_used: 12, rides_left: state.member ? 48 : 0,
        expiry_date: '5 Dec 2026', open_ride: state.openRide ? 'yes' : 'no', open_ride_ref: state.openRide ? 'TR-AAAAAA' : '', open_ride_status: state.openRide ? 'waiting for a driver' : '',
    }),
    'turbo.founding_available': () => ({ pkg_price: '960', pkg_rides: 60, pkg_days: 60, pkg_max_km: 6, pkg_per_ride: '16', founding_cap: 50, founding_left: 12, founding_open: 'yes', hold_minutes: 30 }),
    'turbo.payg_open': () => ({ payg_open: state.payg !== 'closed' ? 'yes' : 'no', payg_reason: state.payg, payg_fare_from: '25', payg_left: 6, hold_minutes: 30 }),
    'turbo.register': (r) => ({ customer_name: r.vars.full_name, welcome_name: String(r.vars.full_name).toUpperCase() }),
    'turbo.destinations': () => ({ destination_menu: 'Reply with a number:\n1. Main Gate\n2. Library\n\nOr share the destination\'s location pin.', dest_count: 2 }),
    'turbo.quote_ride': () => (state.quoteOk === 'unknown'
        ? ({ quote_ok: 'no', quote_code: 'unknown_place', quote_reason: "I couldn't find that place." } as Vars)
        : state.quoteOk
        ? { quote_ok: 'yes', quote_code: 'ok', quote_reason: '', trip_dest: 'Library', trip_dest_lat: '5.66', trip_dest_lng: '-0.19', trip_dest_id: 'd2', trip_km: '2.1', rides_left: 48 }
        : { quote_ok: 'no', quote_code: 'too_far', quote_reason: 'That trip is about 9 km. Founding Package rides cover 0–6 km.', trip_dest: 'Far', trip_dest_lat: '5.7', trip_dest_lng: '-0.1', trip_dest_id: '', trip_km: '9', rides_left: 48 }),
    'turbo.request_ride': () => ({ request_ok: 'yes', request_reason: '', ride_ref: 'TR-BBBBBB' }),
    'turbo.payg_quote': () => ({ quote_ok: 'yes', quote_code: 'ok', quote_reason: '', trip_dest: 'Library', trip_dest_lat: '5.66', trip_dest_lng: '-0.19', trip_dest_id: 'd2', trip_km: '2.1', payg_fare: '25' }),
    'turbo.history': () => ({ history_text: '1. 6 Oct 2026 · Gate → Library · Package · completed', history_count: 1 }),
    'turbo.account': () => ({ account_name: 'Ama Mensah', account_phone: '+233241234567', account_email: 'ama@example.com', account_student_id: '20211234', account_university: 'Central University', package_status: 'Pioneer 50 · 48 rides left · expires 5 Dec 2026' }),
    'turbo.cancel_ride': () => ({ cancel_ok: 'yes', cancel_reason: '❌ Ride TR-AAAAAA cancelled. No ride was deducted.' }),
};

const tenant = { id: 't1', vertical: 'RIDES', activeFlowKey: 'turbo-founding' };
let n = 0;

function setup() {
    const mem = memoryFlowStore({
        definitions: [defRow({ key: 'turbo-founding', version: 1, definition: turboFoundingFlow, tenantId: 't1' })],
        conversations: [{ id: 'c1', customerPhone: '233241234567', botContext: null, contextVersion: 0 }],
    });
    const f = fakePorts();
    f.ports.runAction = runRegisteredAction;
    const deps: FlowRunnerDeps = { store: mem.store, ports: f.ports };
    const say = (text?: string, extra: Record<string, unknown> = {}) =>
        runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: { inboundId: `m${++n}`, text, ...extra } });
    return { say, f, deps, flow: () => readFlowState(mem.conversation('c1').botContext)! };
}

beforeEach(() => {
    n = 0;
    state = { member: false, payg: 'closed', openRide: false, quoteOk: true, calls: [] };
    resetFlowActionsForTests();
    resetPaymentFulfillersForTests();
    for (const name of TURBO_ACTIONS) {
        const fake = async (req: ActionRequest) => { state.calls.push(req); return { ok: true, vars: fakes[name](req) }; };
        // Same wrapping as registerRideFlowActions.
        registerFlowAction(name, name === 'turbo.quote_ride' || name === 'turbo.payg_quote' ? withPlaceMisses(fake) : fake);
    }
    registerPaymentFulfiller('ride_package', async () => ({ status: 'applied' }));
    registerPaymentFulfiller('ride_payg', async () => ({ status: 'applied' }));
});

const WELCOME_HEAD = "Heyya, Turber!!\nWe are currently onboarding our first 50 Founding Members.\n\nFounding Package\n\n• 60 rides\n• Valid for 60 days\n• 0–6 km rides\n• GHS 960\n• That's just GHS 16 per ride\n\n🔥 Only 50 Founding Packages available.";

describe('turbo-founding definition', () => {
    it('is valid once the pack has registered its actions and payment kinds', () => {
        expect(parseFlowDefinition(turboFoundingFlow)).toMatchObject({ ok: true });
    });

    it('is refused when the pack is not registered (a typo can never reach a customer)', () => {
        resetFlowActionsForTests();
        resetPaymentFulfillersForTests();
        const r = parseFlowDefinition(turboFoundingFlow);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors.join('\n')).toMatch(/turbo\.balance[\s\S]*ride_package/);
    });

    it('only calls turbo.* actions', () => {
        const names = Object.values(turboFoundingFlow.states).flatMap((s) => ('action' in s ? [s.action] : []));
        expect(names.every((a) => a.startsWith('turbo.'))).toBe(true);
        expect(new Set(names)).toEqual(new Set(TURBO_ACTIONS));
    });
});

describe('newcomer', () => {
    it('Hi shows TURBO\'s welcome and the 3-option menu while PAYG is closed', async () => {
        const { say } = setup();
        const r = await say('Hi');
        expect(r.reply).toBe(`${WELCOME_HEAD}\n\n1. Get Pioneer Package\n2. Learn More\n3. Contact Support`);
    });

    it('PAYG Ride appears as option 2 while PAYG is switched on, and says when today\'s slots are filled', async () => {
        state.payg = 'open';
        const { say } = setup();
        expect((await say('Hi')).reply).toBe(`${WELCOME_HEAD}\n\n1. Get Pioneer Package\n2. PAYG Ride\n3. Learn More\n4. Contact Support`);
        state.payg = 'full';
        expect((await say('2')).reply).toMatch(/^🔴 PAYG is currently unavailable\n\nToday's available PAYG slots have been filled\./);
    });

    it('buys the Founding Package: details, confirm, pay link, then activation only on the payment event', async () => {
        const { say, f, deps, flow } = setup();
        await say('Hi');
        expect((await say('1')).reply).toBe("Let's get you in! 🚗\n\nWhat's your full name?");
        expect((await say('Ama Mensah')).reply).toBe("What's your Student ID?");
        expect((await say('20211234')).reply).toBe('Which university are you at?');
        expect((await say('Central University')).reply).toBe("What's your email address?");
        const confirm = await say('ama@example.com');
        expect(confirm.reply).toBe("You're almost in! 🚗\n\nFounding Package — GHS 960\n\n60 rides\n60 days validity\n0–6 km\n\nProceed to payment?\n\n1. Pay GHS 960\n2. Cancel");
        expect(state.calls.find((c) => c.name === 'turbo.register')?.vars).toMatchObject({ full_name: 'Ama Mensah', student_id: '20211234', university: 'Central University', email: 'ama@example.com' });

        const pay = await say('1');
        expect(pay.reply).toBe('💳 Pay GHS 960 here (Mobile Money or card):\nhttps://pay.test/ride_package/1\n\nYour Founding slot is held for 30 minutes. Your package is activated as soon as the payment is confirmed.');
        expect(f.calls.payments[0]).toMatchObject({ kind: 'ride_package', amount: 960, currency: 'GHS' });
        expect(flow().status).toBe('waiting');

        // Clicking "Pay" activated nothing: chatter just gets the waiting text.
        expect((await say('done?')).reply).toMatch(/^⏳ We're waiting for your payment/);

        const adv = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded', eventId: 'ref_1', kind: 'ride_package', reference: 'ref_1' } });
        expect(adv.applied).toBe(true);
        expect(adv.reply).toBe("🎉 WELCOME TO TURBO, AMA MENSAH!\n\nYou're officially one of our Founding 50.\n\n🎟️ Your Package\n\n60 rides\nValid for 60 days\n0–6 km\n\nBalance: 60 rides\n\nYou now have priority access to TURBO rides.\n\nWhat would you like to do?\n\n1. Book a Ride\n2. PAYG Ride\n3. Check Balance\n4. Ride History\n5. My Account\n6. Support");
    });

    it('a payment that is not honoured takes the failure branch', async () => {
        const { say, deps } = setup();
        await say('Hi'); await say('1'); await say('Ama Mensah'); await say('20211234'); await say('Central University'); await say('ama@example.com'); await say('1');
        const adv = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.failed', eventId: 'ref_1', kind: 'ride_package', reference: 'ref_1' } });
        expect(adv.reply).toMatch(/^We couldn't complete your Founding Package purchase\. If you were charged, the TURBO team will contact you about a refund\.\n\nHeyya, Turber!!/);
    });

    it('BOOK (even as the opening message) without a package says so and shows the newcomer menu', async () => {
        const { say } = setup();
        const r = await say('BOOK');
        expect(r.reply).toMatch(/^You don't have an active TURBO package yet\.\n\nHeyya, Turber!!/);
    });
});

describe('member', () => {
    beforeEach(() => { state.member = true; });

    it('Hi shows the member menu', async () => {
        const { say } = setup();
        expect((await say('Hi')).reply).toBe('What would you like to do?\n\n1. Book a Ride\n2. PAYG Ride\n3. Check Balance\n4. Ride History\n5. My Account\n6. Support');
    });

    it('books a ride: pickup pin, destination from the list, TURBO\'s confirm text, request received', async () => {
        const { say, flow } = setup();
        await say('Hi');
        expect((await say('1')).reply).toBe('📍 Where should we pick you up?\n\nPlease share your WhatsApp location.');
        const dest = await say(undefined, { location: { latitude: 5.65, longitude: -0.18, name: 'Main Gate' } });
        expect(dest.reply).toBe("📍 Pickup received.\n\nWhere are you going?\n\nReply with a number:\n1. Main Gate\n2. Library\n\nOr share the destination's location pin.");
        const confirm = await say('2');
        expect(flow().vars.dest_text).toBe('2');
        expect(confirm.reply).toBe('🚗 Your TURBO Ride\n\nPickup: Main Gate\nDestination: Library\n\nPackage ride: 1 ride\n\nYour current balance: 48\n\nConfirm?\n\n1. Confirm Ride\n2. Cancel');
        const done = await say('1');
        expect(done.reply).toBe("✅ Ride Request Received\n\nWe're finding your TURBO driver.\n\nPlease stay available.");
        expect(state.calls.find((c) => c.name === 'turbo.request_ride')?.vars).toMatchObject({ pickup_lat: '5.65', trip_dest: 'Library', trip_dest_lat: '5.66' });
    });

    it('a destination outside the package distance is explained and nothing is requested', async () => {
        state.quoteOk = false;
        const { say } = setup();
        await say('Hi'); await say('1');
        await say(undefined, { location: { latitude: 5.65, longitude: -0.18 } });
        const r = await say(undefined, { location: { latitude: 5.75, longitude: -0.1 } });
        expect(r.reply).toMatch(/^That trip is about 9 km\. Founding Package rides cover 0–6 km\.\n\nWhat would you like to do\?/);
        expect(state.calls.some((c) => c.name === 'turbo.request_ride')).toBe(false);
    });

    it('three unknown destinations in a row hand the customer to a person instead of looping', async () => {
        state.quoteOk = 'unknown';
        const { say, flow } = setup();
        await say('Hi'); await say('1');
        await say(undefined, { location: { latitude: 5.65, longitude: -0.18 } });
        expect((await say('asdf')).reply).toMatch(/^I couldn't find that place\./);
        expect((await say('qwer')).reply).toMatch(/^I couldn't find that place\./);
        const third = await say('zxcv');
        expect(third.reply).toMatch(/^I still couldn't find that place, so I'm passing you to the TURBO team\./);
        expect(flow().status).toBe('handed_off');
    });

    it('check balance uses TURBO\'s wording', async () => {
        const { say } = setup();
        await say('Hi');
        expect((await say('3')).reply).toMatch(/^🎟️ Your TURBO Package\n\nPioneer 50\nRides purchased: 60\nRides used: 12\nRides remaining: 48\n\nExpiry: 5 Dec 2026\n\nWhat would you like to do\?/);
    });

    it('PAYG when today\'s slots are filled', async () => {
        state.payg = 'full';
        const { say } = setup();
        await say('Hi');
        expect((await say('2')).reply).toMatch(/^🔴 PAYG is currently unavailable\n\nToday's available PAYG slots have been filled\.\n\nPioneer Members receive priority access\.\n\nPlease try again later\./);
    });

    it('PAYG: fare, pickup, destination, "Your ride is GHS 25", pay link of kind ride_payg, confirmation on payment', async () => {
        state.payg = 'open';
        const { say, f, deps, flow } = setup();
        await say('Hi');
        expect((await say('2')).reply).toBe('🚗 PAY-AS-YOU-GO\n\nFare: GHS 25\n\nEnter your pickup location.\n\nShare your WhatsApp location.');
        await say(undefined, { location: { latitude: 5.65, longitude: -0.18 } });
        expect((await say('Library')).reply).toBe('Your ride is GHS 25.\n\n1. Pay & Book\n2. Cancel');
        const pay = await say('1');
        expect(pay.reply).toMatch(/^💳 Pay GHS 25 here/);
        expect(f.calls.payments[0]).toMatchObject({ kind: 'ride_payg', amount: 25 });
        const adv = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded', eventId: 'r9', kind: 'ride_payg', reference: flow().vars.payment_reference } });
        expect(adv.reply).toBe("✅ Payment Received\n\nYour ride is confirmed.\n\nWe're assigning your driver now.");
    });

    it('an open ride is shown first and can be cancelled', async () => {
        state.openRide = true;
        const { say } = setup();
        expect((await say('Hi')).reply).toBe('🚗 Your ride TR-AAAAAA is waiting for a driver.\n\nWhat would you like to do?\n\n1. Cancel this ride\n2. Main menu\n3. Support');
        state.openRide = false;
        expect((await say('1')).reply).toMatch(/^❌ Ride TR-AAAAAA cancelled\. No ride was deducted\./);
    });

    it('support hands the conversation to a person', async () => {
        const { say, f } = setup();
        await say('Hi');
        const r = await say('6');
        expect(r.wantsHuman).toBe(true);
        expect(f.calls.staff[0]).toMatchObject({ queue: 'support', handoff: true });
    });
});
