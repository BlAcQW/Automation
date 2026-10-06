import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    activatePassOnPayment: vi.fn(), holdFoundingSlot: vi.fn(), recordPassLink: vi.fn(),
    confirmPaygOnPayment: vi.fn(), reservePaygRide: vi.fn(), recordRideLink: vi.fn(), setRideStatus: vi.fn(),
    sendActivationWelcome: vi.fn(), afterRideRequested: vi.fn(), resolveConversationCustomer: vi.fn(), emitPassActivated: vi.fn(), emitRideRequested: vi.fn(),
    advanceFlowOnPackPayment: vi.fn(), publishEventOnce: vi.fn(), raiseAlert: vi.fn(), createNotification: vi.fn(),
    notifyRideCustomer: vi.fn(), getRideSettings: vi.fn(),
}));
vi.mock('./passes.js', () => ({ activatePassOnPayment: m.activatePassOnPayment, holdFoundingSlot: m.holdFoundingSlot, recordPassLink: m.recordPassLink }));
vi.mock('./rides.js', () => ({ confirmPaygOnPayment: m.confirmPaygOnPayment, reservePaygRide: m.reservePaygRide, recordRideLink: m.recordRideLink, setRideStatus: m.setRideStatus }));
vi.mock('./operations.js', () => ({ sendActivationWelcome: m.sendActivationWelcome, afterRideRequested: m.afterRideRequested, resolveConversationCustomer: m.resolveConversationCustomer }));
vi.mock('./events.js', () => ({ emitPassActivated: m.emitPassActivated, emitRideRequested: m.emitRideRequested }));
vi.mock('./settings.js', () => ({ getRideSettings: m.getRideSettings }));
vi.mock('../flow-payments.js', () => ({ advanceFlowOnPackPayment: m.advanceFlowOnPackPayment }));
vi.mock('../events/emit.js', () => ({ publishEventOnce: m.publishEventOnce }));
vi.mock('../alerts.js', () => ({ raiseAlert: m.raiseAlert }));
vi.mock('../notifications.js', () => ({ createNotification: m.createNotification }));
vi.mock('./notify.js', () => ({ notifyRideCustomer: m.notifyRideCustomer }));

import { fulfillRidePackage, fulfillRidePayg, prepareRidePackage, prepareRidePayg, registerRidePayments } from './payments.js';
import { getPaymentFulfiller, resetPaymentFulfillersForTests } from '../payment-fulfillers.js';
import { hasFlowPaymentPreparer, resetFlowPaymentPreparersForTests } from '../flow-ports.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const input = (over: Record<string, unknown> = {}) => ({ prisma: {} as any, tenantId: 't1', entityId: 'p1', reference: 'ref1', amountMinor: 96000, currency: 'GHS', log, ...over });
const pass = { id: 'p1', customerId: 'c1', conversationId: 'conv1' };
const ride = { id: 'r1', customerId: 'c1', conversationId: 'conv1' };

beforeEach(() => {
    vi.clearAllMocks();
    m.createNotification.mockResolvedValue(undefined);
    m.advanceFlowOnPackPayment.mockResolvedValue('advanced');
});

describe('ride_package fulfiller', () => {
    it('activated: money event and ride_pass.activated BEFORE the flow moves; welcome only if the chat did not say it', async () => {
        const order: string[] = [];
        m.emitPassActivated.mockImplementation(async () => { order.push('event'); });
        m.advanceFlowOnPackPayment.mockImplementation(async () => { order.push('flow'); return 'advanced'; });
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'activated', pass });
        expect(await fulfillRidePackage(input())).toEqual({ status: 'applied' });
        expect(m.publishEventOnce).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'payment.succeeded' }), { field: 'reference', equals: 'ref1' });
        expect(m.advanceFlowOnPackPayment).toHaveBeenCalledWith(expect.anything(), { conversationId: 'conv1', kind: 'ride_package', success: true });
        expect(order).toEqual(['event', 'flow']);
        expect(m.sendActivationWelcome).not.toHaveBeenCalled();

        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        await fulfillRidePackage(input());
        expect(m.sendActivationWelcome).toHaveBeenCalledWith(expect.anything(), pass);
    });

    it('a lost flow-state write throws (retried); the retry repeats only the once-only event, never the welcome', async () => {
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'activated', pass });
        m.advanceFlowOnPackPayment.mockRejectedValueOnce(new Error('flow_state_conflict'));
        await expect(fulfillRidePackage(input())).rejects.toThrow('flow_state_conflict');
        expect(m.emitPassActivated).toHaveBeenCalledOnce();
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'already_activated', pass });
        expect(await fulfillRidePackage(input())).toEqual({ status: 'already_applied' });
        expect(m.emitPassActivated).toHaveBeenCalledTimes(2); // publishEventOnce dedupes it
        expect(m.advanceFlowOnPackPayment).toHaveBeenCalledTimes(2);
        expect(m.sendActivationWelcome).not.toHaveBeenCalled();
    });

    it('refused (late, cap full): critical alert + staff notice, flow failure branch, customer told when the chat moved on', async () => {
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'refused', pass, reason: 'cap_full' });
        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        expect(await fulfillRidePackage(input())).toEqual({ status: 'rejected', reason: 'not_activated:cap_full' });
        expect(m.raiseAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_package.not_applied', severity: 'critical', dedupeKey: 'ride_package.not_applied:t1:ref1' }));
        expect(m.createNotification).toHaveBeenCalledOnce();
        expect(m.advanceFlowOnPackPayment).toHaveBeenCalledWith(expect.anything(), { conversationId: 'conv1', kind: 'ride_package', success: false });
        expect(m.notifyRideCustomer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_pass.not_activated', text: expect.stringMatching(/not activated[\s\S]*refund/) }));
        expect(m.sendActivationWelcome).not.toHaveBeenCalled();
    });

    it('a redelivered refusal alerts (deduped) but does not notify staff or the customer again', async () => {
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'already_refused', pass, reason: 'cap_full_after_hold' });
        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        await fulfillRidePackage(input());
        expect(m.createNotification).not.toHaveBeenCalled();
        expect(m.notifyRideCustomer).not.toHaveBeenCalled();
    });

    it('underpaid: payment.failed, TURBO told to refund, failure branch, rejected', async () => {
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'underpaid', pass: { ...pass, priceMinor: 96000 } });
        expect(await fulfillRidePackage(input({ amountMinor: 100 }))).toEqual({ status: 'rejected', reason: 'amount_insufficient' });
        expect(m.publishEventOnce).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'payment.failed' }), expect.anything());
        expect(m.raiseAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_package.not_applied', context: expect.objectContaining({ reason: 'underpaid', owedMinor: 96000 }) }));
        expect(m.createNotification).toHaveBeenCalledOnce();
        expect(m.advanceFlowOnPackPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ success: false }));
    });

    it('unknown pass, and junk inputs, are rejected without touching anything', async () => {
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'not_found' });
        expect(await fulfillRidePackage(input())).toEqual({ status: 'rejected', reason: 'pass_not_found' });
        expect(await fulfillRidePackage(input({ reference: '' }))).toEqual({ status: 'rejected', reason: 'reference_invalid' });
        expect(await fulfillRidePackage(input({ amountMinor: 1.5 }))).toEqual({ status: 'rejected', reason: 'amount_invalid' });
        expect(await fulfillRidePackage(input({ currency: 'GH' }))).toEqual({ status: 'rejected', reason: 'currency_invalid' });
    });

    it('a transient failure (event store down) throws so Paystack retries', async () => {
        m.activatePassOnPayment.mockResolvedValue({ outcome: 'activated', pass });
        m.publishEventOnce.mockRejectedValueOnce(new Error('db down'));
        await expect(fulfillRidePackage(input())).rejects.toThrow('db down');
    });
});

describe('ride_payg fulfiller', () => {
    it('confirmed: flow success; when the chat moved on the customer gets "Payment Received"; ride.requested follows', async () => {
        m.confirmPaygOnPayment.mockResolvedValue({ outcome: 'confirmed', ride });
        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        expect(await fulfillRidePayg(input({ entityId: 'r1', amountMinor: 2500 }))).toEqual({ status: 'applied' });
        expect(m.notifyRideCustomer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_payg.paid', text: expect.stringMatching(/^✅ Payment Received/) }));
        expect(m.afterRideRequested).toHaveBeenCalledWith(expect.anything(), ride);
    });

    it('confirmed while the flow was waiting: the flow reply is the message (no duplicate)', async () => {
        m.confirmPaygOnPayment.mockResolvedValue({ outcome: 'confirmed', ride });
        await fulfillRidePayg(input({ entityId: 'r1', amountMinor: 2500 }));
        expect(m.notifyRideCustomer).not.toHaveBeenCalled();
    });

    it('refused (paid after expiry, no seat): alert + refund notice, rejected', async () => {
        m.confirmPaygOnPayment.mockResolvedValue({ outcome: 'refused', ride, reason: 'capacity_full' });
        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        expect(await fulfillRidePayg(input({ entityId: 'r1', amountMinor: 2500 }))).toEqual({ status: 'rejected', reason: 'not_confirmed:capacity_full' });
        expect(m.raiseAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_payg.not_applied' }));
        expect(m.notifyRideCustomer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_payg.not_confirmed' }));
    });

    it('already confirmed: idempotent (event repeated for safety, no second staff notice)', async () => {
        m.confirmPaygOnPayment.mockResolvedValue({ outcome: 'already_confirmed', ride });
        expect(await fulfillRidePayg(input({ entityId: 'r1' }))).toEqual({ status: 'already_applied' });
        expect(m.afterRideRequested).not.toHaveBeenCalled();
        expect(m.emitRideRequested).toHaveBeenCalledWith(expect.anything(), ride);
    });
});

describe('preparers', () => {
    const prep = (over: Record<string, unknown> = {}) => ({
        prisma: {} as any, tenantId: 't1', conversationId: 'conv1', customerPhone: '233241234567', kind: 'ride_package',
        amount: 960, currency: 'GHS', vars: {}, idempotencyKey: 'conv1:in:pay', ...over,
    });
    beforeEach(() => {
        m.resolveConversationCustomer.mockResolvedValue({ id: 'c1' });
        m.getRideSettings.mockResolvedValue({ packagePriceMinor: 96000, currency: 'GHS' });
    });

    it('package: holds a slot and names the pass as the entity; records the link reference', async () => {
        m.holdFoundingSlot.mockResolvedValue({ ok: true, pass: { id: 'p9' }, reused: false });
        const r = await prepareRidePackage(prep());
        expect(r).toMatchObject({ ok: true, entityId: 'p9' });
        if (r.ok) await r.onCreated({ reference: 'bf_f_x', authorizationUrl: 'u' });
        expect(m.recordPassLink).toHaveBeenCalledWith(expect.anything(), 't1', 'p9', 'bf_f_x');
    });

    it('package: refuses an amount that is not today\'s price, and a sold-out cap', async () => {
        expect(await prepareRidePackage(prep({ amount: 900 }))).toEqual({ ok: false, reason: 'amount_mismatch' });
        m.holdFoundingSlot.mockResolvedValue({ ok: false, reason: 'sold_out' });
        expect(await prepareRidePackage(prep())).toEqual({ ok: false, reason: 'sold_out' });
    });

    it('PAYG: needs the trip in the flow variables, reserves the seat with the expected fare', async () => {
        expect(await prepareRidePayg(prep({ kind: 'ride_payg', amount: 25 }))).toEqual({ ok: false, reason: 'no_trip' });
        m.reservePaygRide.mockResolvedValue({ ok: true, ride: { id: 'r9' }, reused: false });
        const vars = { pickup_lat: '5.65', pickup_lng: '-0.18', pickup_label: 'Gate', trip_dest: 'Library', trip_dest_lat: '5.66', trip_dest_lng: '-0.19', trip_dest_id: 'd2' };
        const r = await prepareRidePayg(prep({ kind: 'ride_payg', amount: 25, vars }));
        expect(r).toMatchObject({ ok: true, entityId: 'r9' });
        expect(m.reservePaygRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            customerId: 'c1', expectedFareMinor: 2500,
            pickup: { label: 'Gate', lat: 5.65, lng: -0.18, id: null }, destination: { label: 'Library', lat: 5.66, lng: -0.19, id: 'd2' },
        }));
        // No link after all: the new seat is released.
        if (r.ok) await r.onFailed?.();
        expect(m.setRideStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rideId: 'r9', status: 'CANCELLED' }));
    });
});

describe('registerRidePayments', () => {
    it('registers both kinds with fulfillers and preparers, and is safe to call twice', () => {
        resetPaymentFulfillersForTests();
        resetFlowPaymentPreparersForTests();
        registerRidePayments();
        registerRidePayments();
        expect(getPaymentFulfiller('ride_package')).toBe(fulfillRidePackage);
        expect(getPaymentFulfiller('ride_payg')).toBe(fulfillRidePayg);
        expect(hasFlowPaymentPreparer('ride_package') && hasFlowPaymentPreparer('ride_payg')).toBe(true);
    });
});
