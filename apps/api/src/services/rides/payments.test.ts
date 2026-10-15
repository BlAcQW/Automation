import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    activatePassOnPayment: vi.fn(), holdFoundingSlot: vi.fn(), recordPassLink: vi.fn(),
    confirmPaygOnPayment: vi.fn(), reservePaygRide: vi.fn(), recordRideLink: vi.fn(), setRideStatus: vi.fn(), reserveTopupRide: vi.fn(), confirmTopupOnPayment: vi.fn(),
    sendActivationWelcome: vi.fn(), afterRideRequested: vi.fn(), resolveConversationCustomer: vi.fn(), emitPassActivated: vi.fn(), emitRideRequested: vi.fn(),
    advanceFlowOnPackPayment: vi.fn(), publishEventOnce: vi.fn(), raiseAlert: vi.fn(), createNotification: vi.fn(),
    notifyRideCustomer: vi.fn(), getRideSettings: vi.fn(),
}));
vi.mock('./passes.js', () => ({ activatePassOnPayment: m.activatePassOnPayment, holdFoundingSlot: m.holdFoundingSlot, recordPassLink: m.recordPassLink }));
vi.mock('./rides.js', () => ({
    confirmPaygOnPayment: m.confirmPaygOnPayment, reservePaygRide: m.reservePaygRide, recordRideLink: m.recordRideLink, setRideStatus: m.setRideStatus,
    reserveTopupRide: m.reserveTopupRide, confirmTopupOnPayment: m.confirmTopupOnPayment,
}));
vi.mock('./operations.js', () => ({ sendActivationWelcome: m.sendActivationWelcome, afterRideRequested: m.afterRideRequested, resolveConversationCustomer: m.resolveConversationCustomer }));
vi.mock('./events.js', () => ({ emitPassActivated: m.emitPassActivated, emitRideRequested: m.emitRideRequested }));
vi.mock('./settings.js', () => ({ getRideSettings: m.getRideSettings }));
vi.mock('../flow-payments.js', () => ({ advanceFlowOnPackPayment: m.advanceFlowOnPackPayment }));
vi.mock('../events/emit.js', () => ({ publishEventOnce: m.publishEventOnce }));
vi.mock('../alerts.js', () => ({ raiseAlert: m.raiseAlert }));
vi.mock('../notifications.js', () => ({ createNotification: m.createNotification }));
vi.mock('./notify.js', () => ({ notifyRideCustomer: m.notifyRideCustomer }));

import { fulfillRidePackage, fulfillRidePayg, fulfillRideTopup, prepareRidePackage, prepareRidePayg, prepareRideTopup, registerRidePayments } from './payments.js';
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

describe('ride_topup fulfiller (a package ride the balance did not cover)', () => {
    const topRide = { id: 'r2', ref: 'TR-2', customerId: 'c1', conversationId: 'conv1', balanceAppliedMinor: 1000, topupMinor: 600, currency: 'GHS' };
    it('confirmed: ride requested, flow success; when the chat moved on the customer is told what the balance pays', async () => {
        m.confirmTopupOnPayment.mockResolvedValue({ outcome: 'confirmed', ride: topRide });
        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        expect(await fulfillRideTopup(input({ entityId: 'r2', amountMinor: 600 }))).toEqual({ status: 'applied' });
        expect(m.confirmTopupOnPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rideId: 'r2', reference: 'ref1', amountMinor: 600 }));
        expect(m.afterRideRequested).toHaveBeenCalledWith(expect.anything(), topRide);
        expect(m.publishEventOnce).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'payment.succeeded', payload: expect.objectContaining({ purpose: 'PACKAGE_TOPUP' }) }), expect.anything());
        expect(m.advanceFlowOnPackPayment).toHaveBeenCalledWith(expect.anything(), { conversationId: 'conv1', kind: 'ride_topup', success: true });
        expect(m.notifyRideCustomer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_topup.paid', text: expect.stringMatching(/GHS 10 from your balance is deducted when the ride is completed/) }));
    });
    it('refused after a lapsed hold (balance changed): loud alert naming the GHS amount to refund', async () => {
        m.confirmTopupOnPayment.mockResolvedValue({ outcome: 'refused', ride: topRide, reason: 'balance_changed' });
        m.advanceFlowOnPackPayment.mockResolvedValue('not_waiting');
        expect(await fulfillRideTopup(input({ entityId: 'r2', amountMinor: 600 }))).toEqual({ status: 'rejected', reason: 'not_confirmed:balance_changed' });
        expect(m.raiseAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            kind: 'ride_topup.not_applied', severity: 'critical', message: expect.stringMatching(/GHS 6 arrived but was not applied \(balance_changed\)\. Refund it/),
        }));
        expect(m.createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ message: expect.stringMatching(/Please refund GHS 6\./) }));
        expect(m.notifyRideCustomer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ride_topup.not_confirmed' }));
    });
    it('underpaid and redelivery', async () => {
        m.confirmTopupOnPayment.mockResolvedValue({ outcome: 'underpaid', ride: topRide });
        expect(await fulfillRideTopup(input({ entityId: 'r2', amountMinor: 100 }))).toEqual({ status: 'rejected', reason: 'amount_insufficient' });
        m.confirmTopupOnPayment.mockResolvedValue({ outcome: 'already_confirmed', ride: topRide });
        expect(await fulfillRideTopup(input({ entityId: 'r2', amountMinor: 600 }))).toEqual({ status: 'already_applied' });
        m.confirmTopupOnPayment.mockResolvedValue({ outcome: 'not_found' });
        expect(await fulfillRideTopup(input({ entityId: 'r2', amountMinor: 600 }))).toEqual({ status: 'rejected', reason: 'ride_not_found' });
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

    it('top-up: the link amount is the difference; the fare shown is checked too', async () => {
        const vars = { pickup_lat: '5.65', pickup_lng: '-0.18', pickup_label: 'Gate', trip_dest: 'Library', trip_dest_lat: '5.66', trip_dest_lng: '-0.19', trip_dest_id: 'd2', pkg_fare: '16' };
        m.reserveTopupRide.mockResolvedValue({ ok: true, ride: { id: 'r7' }, reused: false });
        const r = await prepareRideTopup(prep({ kind: 'ride_topup', amount: 6, vars }));
        expect(r).toMatchObject({ ok: true, entityId: 'r7' });
        expect(m.reserveTopupRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerId: 'c1', expectedTopupMinor: 600, expectedFareMinor: 1600 }));
        if (r.ok) await r.onCreated({ reference: 'ref7', authorizationUrl: 'u' });
        expect(m.recordRideLink).toHaveBeenCalledWith(expect.anything(), 't1', 'r7', 'ref7');
        m.reserveTopupRide.mockResolvedValue({ ok: false, reason: 'fare_changed' });
        expect(await prepareRideTopup(prep({ kind: 'ride_topup', amount: 6, vars }))).toEqual({ ok: false, reason: 'fare_changed' });
        expect(await prepareRideTopup(prep({ kind: 'ride_topup', amount: 6, vars: {} }))).toEqual({ ok: false, reason: 'no_trip' });
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
        expect(getPaymentFulfiller('ride_topup')).toBe(fulfillRideTopup);
        expect(hasFlowPaymentPreparer('ride_package') && hasFlowPaymentPreparer('ride_payg') && hasFlowPaymentPreparer('ride_topup')).toBe(true);
    });
});
