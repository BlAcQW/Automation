import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());
vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));
vi.mock('./alerts.js', () => ({ raiseAlert: vi.fn() }));
vi.mock('./crypto.js', async (orig) => ({ ...(await orig<any>()), decrypt: (v: string) => `dec:${v}` }));
const sendChannelText = vi.fn();
vi.mock('./channel-send.js', async (orig) => ({
    ...(await orig<typeof import('./channel-send.js')>()),
    sendChannelText: (...a: unknown[]) => sendChannelText(...a),
}));
const tryReserveOutbound = vi.fn();
vi.mock('./usage.js', () => ({
    checkOutboundQuota: async () => ({ ok: true }),
    tryReserveOutbound: (...a: unknown[]) => tryReserveOutbound(...a),
    rollbackOutboundReservation: vi.fn(async () => undefined),
}));

import { publishEvent } from './events/publish.js';
import { raiseAlert } from './alerts.js';
import { getPaymentFulfiller, resetPaymentFulfillersForTests } from './payment-fulfillers.js';
import { readFlowState } from './flows/index.js';
import {
    FLOW_PAYMENT_KIND,
    encodeFlowEntityId,
    decodeFlowEntityId,
    registerFlowPaymentFulfiller,
    canEncodeFlowEntityId,
} from './flow-payments.js';
import { makeFlowKit, PAY_FLOW, PAY_THEN_STAFF_FLOW } from '../test-utils/flow-kit.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const entityId = (over: Record<string, unknown> = {}) =>
    encodeFlowEntityId({ conversationId: 'c1', state: 'pay', amountMinor: 2500, currency: 'GHS', ...over } as any);

function setup(definition: Record<string, any> = PAY_FLOW) {
    const kit = makeFlowKit({ definition });
    kit.installPublish(publish);
    kit.seedWaiting();
    const input = (over: Record<string, unknown> = {}) => ({
        prisma: kit.prisma, tenantId: 't1', entityId: entityId(), reference: 'bf_f_old', amountMinor: 2500, currency: 'GHS', log, ...over,
    });
    const fulfil = (over: Record<string, unknown> = {}) => getPaymentFulfiller(FLOW_PAYMENT_KIND)!(input(over) as any);
    return { kit, fulfil };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetPaymentFulfillersForTests();
    registerFlowPaymentFulfiller();
    tryReserveOutbound.mockResolvedValue({ ok: true });
    sendChannelText.mockResolvedValue({ messageId: 'wamid.OUT' });
});

describe('entity id', () => {
    it('round-trips conversation, state, amount and currency', () => {
        const id = entityId();
        expect(decodeFlowEntityId(id)).toEqual({ conversationId: 'c1', state: 'pay', amountMinor: 2500, currency: 'GHS' });
    });

    it('stays within the 100 character limit for the longest legal inputs', () => {
        const id = encodeFlowEntityId({
            conversationId: 'c'.repeat(30), state: 's'.repeat(40), amountMinor: 999_999_999_999, currency: 'GHS',
        });
        expect(id.length).toBeLessThanOrEqual(100);
    });

    it.each(['', 'nope', 'a.b.c', 'c1.pay.abc.GHS', 'c1.pay.-5.GHS', 'c1.pay.2500.ghs', 'c1.PAY.2500.GHS', 'c1.pay.2500.GHS.x'])(
        'rejects the malformed id %j',
        (bad) => expect(decodeFlowEntityId(bad)).toBeNull(),
    );
});

describe('canEncodeFlowEntityId', () => {
    const ok = { conversationId: 'c1', state: 'pay', amountMinor: 2500, currency: 'GHS' };
    it('accepts a normal entity and the 12-digit maximum', () => {
        expect(canEncodeFlowEntityId(ok)).toBe(true);
        expect(canEncodeFlowEntityId({ ...ok, amountMinor: 999_999_999_999 })).toBe(true);
    });
    it.each([
        ['13 digits', { amountMinor: 1_000_000_000_000 }],
        ['zero', { amountMinor: 0 }],
        ['fractional', { amountMinor: 12.5 }],
        ['NaN', { amountMinor: Number.NaN }],
        ['bad state', { state: 'Pay' }],
        ['bad currency', { currency: 'gh' }],
        ['bad conversation id', { conversationId: 'a.b' }],
        ['too long overall', { conversationId: 'c'.repeat(41) }],
    ])('rejects %s', (_n, over) => expect(canEncodeFlowEntityId({ ...ok, ...over } as any)).toBe(false));
});

describe('registration', () => {
    it('registers kind flow_payment and is safe to call twice', () => {
        registerFlowPaymentFulfiller();
        expect(FLOW_PAYMENT_KIND).toBe('flow_payment');
        expect(getPaymentFulfiller('flow_payment')).toBeTypeOf('function');
    });
});

describe('flow_payment fulfiller', () => {
    it('advances the waiting flow, sends the reply through the outbox and publishes payment.succeeded once', async () => {
        const { kit, fulfil } = setup();
        const out = await fulfil();

        expect(out).toEqual({ status: 'applied' });
        expect(readFlowState(kit.conv.botContext)!.status).toBe('ended');

        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0]).toMatchObject({ channel: 'WHATSAPP', recipientId: '233241234567', text: 'Paid. Thanks!' });
        expect(kit.outbound()).toHaveLength(1);
        expect(kit.outbound()[0]).toMatchObject({ sendState: 'SENT', conversationId: 'c1', replyToId: null });

        const paid = kit.eventsOfType('payment.succeeded');
        expect(paid).toHaveLength(1);
        expect(paid[0]).toMatchObject({
            tenantId: 't1',
            payload: { v: 1, reference: 'bf_f_old', paymentId: 'bf_f_old', amount: 2500, currency: 'GHS', conversationId: 'c1' },
        });
    });

    it('is idempotent per reference across sequential duplicate deliveries', async () => {
        const { kit, fulfil } = setup();
        const first = await fulfil();
        const second = await fulfil();
        const third = await fulfil();

        expect(first.status).toBe('applied');
        expect(second).toEqual({ status: 'already_applied' });
        expect(third).toEqual({ status: 'already_applied' });
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('is idempotent under CONCURRENT duplicate deliveries', async () => {
        const { kit, fulfil } = setup();
        const results = await Promise.all([fulfil(), fulfil(), fulfil(), fulfil()]);

        expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'already_applied')).toHaveLength(3);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('an underpayment is rejected, recorded once as payment.failed, and the flow takes its failure branch so the customer is told', async () => {
        const { kit, fulfil } = setup();
        const out = await fulfil({ amountMinor: 1000 });
        expect(out).toEqual({ status: 'rejected', reason: 'amount_insufficient' });

        expect(readFlowState(kit.conv.botContext)!.current).toBe('failed');
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(0);
        const failed = kit.eventsOfType('payment.failed');
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({
            tenantId: 't1',
            payload: { v: 1, reference: 'bf_f_old', paymentId: 'bf_f_old', amount: 1000, currency: 'GHS', conversationId: 'c1', reason: 'underpaid' },
        });
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(sendChannelText.mock.calls[0][0].text).toBe('Payment failed.');

        // Paystack redelivers: nothing repeats.
        await fulfil({ amountMinor: 1000 });
        expect(kit.eventsOfType('payment.failed')).toHaveLength(1);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
    });

    it('an underpayment for a link the flow is no longer waiting on is recorded but does not touch the flow', async () => {
        const { kit, fulfil } = setup();
        kit.seedWaiting({ vars: { payment_url: 'u', payment_reference: 'bf_f_new' } });
        const out = await fulfil({ amountMinor: 1000 });
        expect(out).toEqual({ status: 'rejected', reason: 'amount_insufficient' });
        expect(kit.eventsOfType('payment.failed')).toHaveLength(1);
        expect(readFlowState(kit.conv.botContext)!.current).toBe('pay');
        expect(readFlowState(kit.conv.botContext)!.status).toBe('waiting');
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('a transient publish failure on an underpayment throws (nothing is lost) and the retry completes', async () => {
        const { kit, fulfil } = setup();
        publish.mockRejectedValueOnce(new Error('events db down'));
        await expect(fulfil({ amountMinor: 1000 })).rejects.toThrow('events db down');
        expect(readFlowState(kit.conv.botContext)!.status).toBe('waiting');
        await fulfil({ amountMinor: 1000 });
        expect(kit.eventsOfType('payment.failed')).toHaveLength(1);
        expect(readFlowState(kit.conv.botContext)!.current).toBe('failed');
    });

    it('accepts an overpayment and a one-pesewa rounding difference', async () => {
        const a = setup();
        expect((await a.fulfil({ amountMinor: 9999 })).status).toBe('applied');
        const b = setup();
        expect((await b.fulfil({ amountMinor: 2499 })).status).toBe('applied');
    });

    it('rejects a currency that differs from the one the link was made in', async () => {
        const { fulfil, kit } = setup();
        expect(await fulfil({ currency: 'USD' })).toEqual({ status: 'rejected', reason: 'currency_mismatch' });
        expect(kit.events).toHaveLength(0);
    });

    it('rejects a malformed entity id and invalid references/amounts', async () => {
        const { fulfil } = setup();
        expect(await fulfil({ entityId: 'garbage' })).toEqual({ status: 'rejected', reason: 'entity_ref_invalid' });
        expect(await fulfil({ reference: '' })).toEqual({ status: 'rejected', reason: 'reference_invalid' });
        expect(await fulfil({ amountMinor: 0 })).toEqual({ status: 'rejected', reason: 'amount_invalid' });
        expect(await fulfil({ amountMinor: 12.5 })).toEqual({ status: 'rejected', reason: 'amount_invalid' });
    });

    it('rejects a conversation that does not exist for THIS tenant', async () => {
        const { fulfil, kit } = setup();
        const out = await fulfil({ entityId: entityId({ conversationId: 'other-conv' }) });
        expect(out).toEqual({ status: 'rejected', reason: 'conversation_not_found' });
        expect(kit.events).toHaveLength(0);
    });

    it('a payment that finds the flow elsewhere is recorded (event) and raises an alert, no reply', async () => {
        const { kit, fulfil } = setup();
        // The customer moved on: the link is for state "pay" but the flow is finished.
        kit.seedWaiting({ status: 'ended', current: 'done' });
        const out = await fulfil();

        expect(out).toEqual({ status: 'applied' });
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect((raiseAlert as any).mock.calls[0][1]).toMatchObject({
            kind: 'flow_payment.unmatched', severity: 'warning', tenantId: 't1', dedupeKey: expect.stringContaining('bf_f_old'),
        });
    });

    it('STALE LINK: paying an old cheaper link after choosing a dearer option does not advance the flow', async () => {
        const { kit, fulfil } = setup();
        // The customer chose the 10.00 option (link bf_f_old), then the 25.00 one (link bf_f_new): same step name.
        kit.seedWaiting({ vars: { payment_url: 'https://pay.test/new', payment_reference: 'bf_f_new' } });
        const out = await fulfil({ reference: 'bf_f_old', amountMinor: 1000, entityId: entityId({ amountMinor: 1000 }) });

        expect(out).toEqual({ status: 'applied' }); // the money is real and recorded...
        expect(readFlowState(kit.conv.botContext)!.status).toBe('waiting'); // ...but it did not buy the dearer ride
        expect(readFlowState(kit.conv.botContext)!.current).toBe('pay');
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        expect((raiseAlert as any).mock.calls[0][1]).toMatchObject({ kind: 'flow_payment.unmatched', dedupeKey: expect.stringContaining('bf_f_old') });

        // Redelivery: still one event, still no advance.
        expect(await fulfil({ reference: 'bf_f_old', amountMinor: 1000, entityId: entityId({ amountMinor: 1000 }) })).toEqual({ status: 'already_applied' });
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(readFlowState(kit.conv.botContext)!.status).toBe('waiting');

        // The alert is raised on EVERY unmatched delivery, so a retry after the alert step failed still raises it
        // (its dedupeKey, per reference, is what stops duplicates).
        expect(raiseAlert).toHaveBeenCalledTimes(2);
        expect((raiseAlert as any).mock.calls[1][1].dedupeKey).toBe((raiseAlert as any).mock.calls[0][1].dedupeKey);

        // The real link still works afterwards.
        const real = await fulfil({ reference: 'bf_f_new' });
        expect(real.status).toBe('applied');
        expect(readFlowState(kit.conv.botContext)!.status).toBe('ended');
    });

    it('STALE LINK, no reference recorded on the step: the CURRENT step amount still blocks a cheap link', async () => {
        const { kit, fulfil } = setup(); // the step costs 25.00
        kit.seedWaiting({ vars: { payment_url: 'u', payment_reference: '' } });
        const out = await fulfil({ reference: 'bf_f_old', amountMinor: 1000, entityId: entityId({ amountMinor: 1000 }) });
        // The link itself was fully paid (so not "underpaid" for that link) but not enough for this step.
        expect(out).toEqual({ status: 'applied' });
        expect(readFlowState(kit.conv.botContext)!.status).toBe('waiting');
        expect(raiseAlert).toHaveBeenCalledTimes(1);
    });

    it('announces flow.completed (v1, no sensitive vars) when the payment finishes the flow', async () => {
        const { kit, fulfil } = setup();
        await fulfil();
        const done = kit.eventsOfType('flow.completed');
        expect(done).toHaveLength(1);
        expect(done[0]).toMatchObject({
            tenantId: 't1',
            payload: { v: 1, flowKey: 'pay-flow', version: 1, conversationId: 'c1', customerId: null, vars: {} },
        });
        expect(JSON.stringify(done[0].payload)).not.toMatch(/payment_url|payment_reference|233241234567/);
        await fulfil(); // redelivery
        expect(kit.eventsOfType('flow.completed')).toHaveLength(1);
    });

    it('does not announce flow.completed when the flow hands off instead', async () => {
        const { kit, fulfil } = setup(PAY_THEN_STAFF_FLOW);
        await fulfil();
        expect(kit.eventsOfType('flow.completed')).toHaveLength(0);
    });

    it('a stale link for an EARLIER payment state cannot advance a later one', async () => {
        const { kit, fulfil } = setup();
        kit.seedWaiting({ current: 'pay2' });
        const out = await fulfil(); // link encodes state "pay"
        expect(out.status).toBe('applied'); // recorded...
        expect(readFlowState(kit.conv.botContext)!.current).toBe('pay2'); // ...but not advanced
        expect(raiseAlert).toHaveBeenCalledTimes(1);
    });

    it('a flow that hands off on success takes the conversation to a person exactly once', async () => {
        const { kit, fulfil } = setup(PAY_THEN_STAFF_FLOW);
        const out = await fulfil();
        expect(out.status).toBe('applied');
        expect(kit.conv.state).toBe('HUMAN_ACTIVE');
        expect(kit.conv.takeoverReason).toBe('dispatch');
        // The staff port took over; the fulfiller must not take over a second time.
        const takeovers = kit.prisma.conversation.update.mock.calls.filter((c: any) => c[0].data.state === 'HUMAN_ACTIVE');
        expect(takeovers).toHaveLength(1);
        expect(kit.eventsOfType('conversation.handoff')).toHaveLength(1);
        expect(sendChannelText.mock.calls[0][0].text).toBe('Thanks, a person will confirm.');
    });

    it('a failed send does not fail the fulfilment (the flow already advanced) and is alerted', async () => {
        const { kit, fulfil } = setup();
        sendChannelText.mockRejectedValue(new Error('graph down'));
        const out = await fulfil();
        expect(out).toEqual({ status: 'applied' });
        expect(readFlowState(kit.conv.botContext)!.status).toBe('ended');
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(kit.outbound()[0]).toMatchObject({ sendState: 'PENDING', content: 'Paid. Thanks!' });
        expect((raiseAlert as any).mock.calls.map((c: any) => c[1].kind)).toContain('flow_payment.reply_failed');
        // A redelivery must not resend or republish.
        expect(await fulfil()).toEqual({ status: 'already_applied' });
        expect(sendChannelText).toHaveBeenCalledTimes(1);
    });

    it('throws on a transient publish failure BEFORE touching the flow, so the retry still advances it', async () => {
        const { kit, fulfil } = setup();
        publish.mockRejectedValueOnce(new Error('events db down'));
        await expect(fulfil()).rejects.toThrow('events db down');
        expect(readFlowState(kit.conv.botContext)!.status).toBe('waiting');

        const out = await fulfil(); // Paystack retries
        expect(out).toEqual({ status: 'applied' });
        expect(readFlowState(kit.conv.botContext)!.status).toBe('ended');
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
    });

    it('still advances (and replies once) when a redelivery arrives after a crash between publish and advance', async () => {
        const { kit, fulfil } = setup();
        // First delivery got as far as publishing, then died: simulate by
        // pre-recording the event only.
        kit.events.push({ id: 'e0', tenantId: 't1', type: 'payment.succeeded', dedupeKey: 'payment.succeeded:reference:bf_f_old', payload: { v: 1, reference: 'bf_f_old' } });
        const out = await fulfil();
        expect(out).toEqual({ status: 'applied' });
        expect(readFlowState(kit.conv.botContext)!.status).toBe('ended');
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1); // not published twice
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('with the channel unconfigured, the reply is suppressed but the payment still lands', async () => {
        const kit = makeFlowKit({ tenant: { whatsappPhoneNumberId: null } });
        kit.installPublish(publish);
        kit.seedWaiting();
        const out = await getPaymentFulfiller(FLOW_PAYMENT_KIND)!({
            prisma: kit.prisma, tenantId: 't1', entityId: entityId(), reference: 'ref-9', amountMinor: 2500, currency: 'GHS', log,
        } as any);
        expect(out.status).toBe('applied');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(kit.eventsOfType('payment.succeeded')).toHaveLength(1);
    });
});

describe('advanceFlowOnPackPayment (pack kinds, e.g. ride_package)', () => {
    const PACK_FLOW = {
        key: 'pack-flow', version: 1, start: 'pay',
        states: {
            pay: { type: 'payment', prompt: 'Pay here: {payment_url}', kind: 'ride_package', amount: 25, onSuccess: 'done', onFailure: 'failed' },
            done: { type: 'end', text: 'Activated!' },
            failed: { type: 'end', text: 'Not activated.' },
        },
    };
    let pack: typeof import('./flow-payments.js').advanceFlowOnPackPayment;
    beforeEach(async () => {
        resetPaymentFulfillersForTests();
        const { registerPaymentFulfiller } = await import('./payment-fulfillers.js');
        registerPaymentFulfiller('ride_package', async () => ({ status: 'applied' }));
        ({ advanceFlowOnPackPayment: pack } = await import('./flow-payments.js'));
    });
    const kitFor = () => {
        const kit = makeFlowKit({ definition: PACK_FLOW });
        kit.installPublish(publish);
        kit.seedWaiting();
        const input = (over: Record<string, unknown> = {}) => ({ prisma: kit.prisma, tenantId: 't1', entityId: 'p1', reference: 'bf_f_old', amountMinor: 2500, currency: 'GHS', log, ...over }) as any;
        return { kit, input };
    };

    it('moves the waiting flow to its success branch and sends the reply once', async () => {
        const { kit, input } = kitFor();
        expect(await pack(input(), { conversationId: 'c1', kind: 'ride_package', success: true })).toBe('advanced');
        expect(kit.outbound().map((m) => m.content)).toEqual(['Activated!']);
        expect(readFlowState(kit.conv.botContext)?.status).toBe('ended');
        // Redelivery: already applied, nothing sent again.
        expect(await pack(input(), { conversationId: 'c1', kind: 'ride_package', success: true })).toBe('already');
        expect(kit.outbound()).toHaveLength(1);
    });

    it('a refused payment takes the failure branch', async () => {
        const { kit, input } = kitFor();
        expect(await pack(input(), { conversationId: 'c1', kind: 'ride_package', success: false })).toBe('advanced');
        expect(kit.outbound().map((m) => m.content)).toEqual(['Not activated.']);
    });

    it('an old link (other reference), another kind or a chat that moved on: not_waiting, nothing sent', async () => {
        const { kit, input } = kitFor();
        expect(await pack(input({ reference: 'bf_f_other' }), { conversationId: 'c1', kind: 'ride_package', success: true })).toBe('not_waiting');
        expect(await pack(input(), { conversationId: 'c1', kind: 'ride_payg', success: true })).toBe('not_waiting');
        expect(await pack(input(), { conversationId: 'nope', kind: 'ride_package', success: true })).toBe('not_waiting');
        expect(kit.outbound()).toHaveLength(0);
    });
});
