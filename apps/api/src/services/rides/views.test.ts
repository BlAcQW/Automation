import { describe, it, expect } from 'vitest';
import { balanceLogView, customerSummary, currentPass, packagePaymentStatus, packagePaymentView, passStatusOf, passView, paygPaymentStatus, paygPaymentView, rideView } from './views.js';

const now = new Date('2026-10-06T12:00:00Z');
const pass = (over: Record<string, unknown> = {}) => ({
    id: 'p1', tenantId: 't1', customerId: 'c1', conversationId: null, status: 'ACTIVE', ridesTotal: 60, validityDays: 60, maxKm: 6,
    priceMinor: 96000, creditMinor: 96000, currency: 'GHS', holdExpiresAt: null, activatedAt: now, expiresAt: new Date('2026-12-05T12:00:00Z'),
    paymentReference: 'ref', paidAt: now, paidAmountMinor: 96000, cancelledAt: null, cancelReason: null,
    expiryReminderSentAt: null, lowBalanceReminderSentAt: null, createdAt: now, updatedAt: now, ...over,
}) as any;

describe('pass status as the console shows it', () => {
    it('maps HELD to PENDING_PAYMENT and an empty ACTIVE pass to EXHAUSTED', () => {
        expect(passStatusOf({ status: 'HELD' }, 0)).toBe('PENDING_PAYMENT');
        expect(passStatusOf({ status: 'ACTIVE' }, 1600)).toBe('ACTIVE');
        expect(passStatusOf({ status: 'ACTIVE' }, 0)).toBe('EXHAUSTED');
        expect(passStatusOf({ status: 'EXPIRED' }, 0)).toBe('EXPIRED');
        expect(passStatusOf({ status: 'CANCELLED' }, 0)).toBe('CANCELLED');
    });

    it('passView carries GHS credit, used, remaining and the rides taken (no ride counts)', () => {
        expect(passView(pass(), { purchasedMinor: 96000, usedMinor: 19200, remainingMinor: 76800, ridesTaken: 12 })).toEqual({
            id: 'p1', name: 'Pioneer 50', status: 'ACTIVE', price: '960.00', credit: '960.00', used: '192.00', remaining: '768.00', ridesTaken: 12,
            activatedAt: now, expiresAt: new Date('2026-12-05T12:00:00Z'), createdAt: now,
        });
        expect(passView(pass({ status: 'HELD', activatedAt: null }), undefined).remaining).toBe('0.00');
        // Old rows without creditMinor: the credit is the price paid.
        expect(passView(pass({ creditMinor: null }), undefined).credit).toBe('960.00');
    });

    it('currentPass prefers the ACTIVE pass over a newer one', () => {
        const active = pass({ id: 'a', createdAt: new Date('2026-01-01') });
        const newer = pass({ id: 'b', status: 'CANCELLED', createdAt: new Date('2026-02-01') });
        expect(currentPass([newer, active])?.id).toBe('a');
        expect(currentPass([newer])?.id).toBe('b');
        expect(currentPass([])).toBeNull();
    });
});

describe('customerSummary', () => {
    const c = { id: 'c1', name: 'Ama', phone: '+233241234567', attributes: { studentId: ' 2021 ', university: 'CU', other: 1 }, createdAt: now };
    it('flattens student id and university, masks the phone when asked', () => {
        const s = customerSummary(c, [pass()], new Map([['p1', { purchasedMinor: 96000, usedMinor: 1600, remainingMinor: 94400, ridesTaken: 1 }]]), true);
        expect(s).toMatchObject({ id: 'c1', studentId: '2021', university: 'CU', balance: '944.00', package: { id: 'p1', name: 'Pioneer 50', status: 'ACTIVE' } });
        expect(s.phone).not.toBe(c.phone);
        expect(customerSummary(c, [], new Map(), false)).toMatchObject({ phone: c.phone, package: null, balance: null, expiresAt: null });
    });
    it('never trusts attributes JSON', () => {
        expect(customerSummary({ ...c, attributes: ['x'] }, [], new Map(), false)).toMatchObject({ studentId: null, university: null });
    });
});

describe('balanceLogView', () => {
    it('renames PURCHASE to ACTIVATION, signed GHS amounts and the running GHS balance per pass, newest first', () => {
        const e = (id: string, type: string, amountMinor: number, at: string, rideId: string | null = null, passId = 'p1') =>
            ({ id, tenantId: 't1', passId, type, amountMinor, delta: null, rideId, reference: null, note: null, createdAt: new Date(at) }) as any;
        const out = balanceLogView([
            e('3', 'RIDE', -2500, '2026-10-03', 'r2'), e('1', 'PURCHASE', 96000, '2026-10-01'), e('2', 'RIDE', -1600, '2026-10-02', 'r1'), e('4', 'PURCHASE', 96000, '2026-10-02', null, 'p2'),
        ], new Map([['r1', 'TR-1'], ['r2', 'TR-2']]));
        expect(out.map((x) => [x.id, x.reason, x.amount, x.balanceAfter, x.rideRef])).toEqual([
            ['3', 'RIDE', '-25.00', '919.00', 'TR-2'], ['4', 'ACTIVATION', '960.00', '960.00', null], ['2', 'RIDE', '-16.00', '944.00', 'TR-1'], ['1', 'ACTIVATION', '960.00', '960.00', null],
        ]);
        expect(out[0].delta).toBeNull();
    });
});

describe('payment status', () => {
    it('package: paid = SUCCEEDED, live hold = PENDING, anything else = FAILED', () => {
        expect(packagePaymentStatus({ paidAt: now, status: 'CANCELLED', holdExpiresAt: null }, now)).toBe('SUCCEEDED');
        expect(packagePaymentStatus({ paidAt: null, status: 'HELD', holdExpiresAt: new Date(now.getTime() + 1) }, now)).toBe('PENDING');
        expect(packagePaymentStatus({ paidAt: null, status: 'HELD', holdExpiresAt: new Date(now.getTime() - 1) }, now)).toBe('FAILED');
    });
    it('PAYG: paid = SUCCEEDED, unexpired PENDING_PAYMENT = PENDING, else FAILED', () => {
        expect(paygPaymentStatus({ paidAt: now, status: 'REQUESTED', paymentExpiresAt: null }, now)).toBe('SUCCEEDED');
        expect(paygPaymentStatus({ paidAt: null, status: 'PENDING_PAYMENT', paymentExpiresAt: new Date(now.getTime() + 1) }, now)).toBe('PENDING');
        expect(paygPaymentStatus({ paidAt: null, status: 'CANCELLED', paymentExpiresAt: null }, now)).toBe('FAILED');
    });
});

describe('rideView (the console Ride type)', () => {
    const base = {
        id: 'r1', ref: 'TR-1', kind: 'PACKAGE', status: 'ASSIGNED', pickupLabel: 'Gate', pickupLat: 1, pickupLng: 2,
        destinationLabel: 'Library', destinationLat: 3, destinationLng: 4, distanceKm: 1.25, fareMinor: 0, priceDistanceKm: null, priceBasis: null, fareBand: null,
        paidAmountMinor: null, topupMinor: null, waivedMinor: null, balanceAppliedMinor: null, deductedMinor: null, balanceAfterMinor: null,
        requestedAt: now, assignedAt: now, completedAt: null, cancelledAt: null, cancelReason: null,
        customer: { id: 'c1', name: 'Ama', phone: '+233241234567' },
        driver: { id: 'd1', name: 'Kofi', vehicle: 'Vitz', plate: 'GR 1', phone: '+233200000000' },
    } as any;
    it('old package rides (never priced) have fare null; the driver phone is not exposed', () => {
        expect(rideView(base, false)).toEqual({
            id: 'r1', ref: 'TR-1', kind: 'PACKAGE', status: 'ASSIGNED', customer: { id: 'c1', name: 'Ama', phone: '+233241234567' },
            pickup: { label: 'Gate', lat: 1, lng: 2 }, destination: { label: 'Library', lat: 3, lng: 4 }, distanceKm: 1.25, fare: null,
            paid: null, topup: null, waived: null, balanceApplied: null, deducted: null, balanceAfter: null, priceDistanceKm: null, priceBasis: null, fareBand: null,
            driver: { id: 'd1', name: 'Kofi', vehicle: 'Vitz', plate: 'GR 1' }, requestedAt: now, assignedAt: now, completedAt: null,
            cancelledAt: null, cancelReason: null,
        });
    });
    it('PAYG rides carry the fare as a major-unit string; masking applies to the customer', () => {
        const v = rideView({ ...base, kind: 'PAYG', fareMinor: 2500, driver: null }, true);
        expect(v.fare).toBe('25.00');
        expect(v.driver).toBeNull();
        expect(v.customer.phone).not.toBe('+233241234567');
    });
    it('package rides carry the band fare and how it was paid (balance, top-up, waiver) and deducted', () => {
        const v = rideView({
            ...base, status: 'COMPLETED', fareMinor: 2500, priceDistanceKm: 7.4, priceBasis: 'REFERENCE', fareBand: '6–10 km',
            paidAmountMinor: 900, topupMinor: 900, waivedMinor: 0, balanceAppliedMinor: 1600, deductedMinor: 1600, balanceAfterMinor: 0,
        }, false);
        expect(v).toMatchObject({
            fare: '25.00', paid: '9.00', topup: '9.00', waived: '0.00', balanceApplied: '16.00', deducted: '16.00', balanceAfter: '0.00',
            priceDistanceKm: 7.4, priceBasis: 'REFERENCE', fareBand: '6–10 km',
        });
    });
});

describe('payment views carry a purpose', () => {
    const customer = { id: 'c1', name: 'Ama', phone: '+233241234567' };
    it('package purchase, PAYG ride, package top-up (kind PACKAGE)', () => {
        expect(packagePaymentView({ ...pass(), customer }, false, now)).toMatchObject({ kind: 'PACKAGE', purpose: 'PACKAGE_PURCHASE', amount: '960.00' });
        const r = { id: 'r1', ref: 'TR-1', kind: 'PAYG', passId: null, fareMinor: 2500, topupMinor: null, paidAmountMinor: null, paidAt: null, status: 'PENDING_PAYMENT', paymentExpiresAt: new Date(now.getTime() + 1), currency: 'GHS', paymentReference: null, providerTransactionId: null, paymentChannel: null, createdAt: now, customer } as any;
        expect(paygPaymentView(r, false, now)).toMatchObject({ kind: 'PAYG', purpose: 'PAYG_RIDE', amount: '25.00', status: 'PENDING', passId: null });
        expect(paygPaymentView({ ...r, kind: 'PACKAGE', passId: 'p1', fareMinor: 4000, topupMinor: 2400 }, false, now))
            .toMatchObject({ kind: 'PACKAGE', purpose: 'PACKAGE_TOPUP', amount: '24.00', rideRef: 'TR-1', passId: 'p1' });
    });
});

describe('payment views name the provider that took the money', () => {
    const customer = { id: 'c1', name: 'Ama', phone: '+233241234567' };
    const r = { id: 'r1', ref: 'TR-1', kind: 'PAYG', passId: null, fareMinor: 2500, topupMinor: null, paidAmountMinor: 2500, paidAt: now, status: 'REQUESTED', paymentExpiresAt: null, currency: 'GHS', paymentReference: 'bf_f_x', providerTransactionId: 'PZ1', paymentChannel: 'GH_MOBILEMONEY', createdAt: now, customer } as any;
    it('PAYSTACK / PAYAZA as recorded, null when unknown or unrecognised', () => {
        expect(packagePaymentView({ ...pass(), paymentProvider: 'PAYAZA', customer } as any, false, now).provider).toBe('PAYAZA');
        expect(packagePaymentView({ ...pass(), paymentProvider: null, customer } as any, false, now).provider).toBeNull();
        expect(paygPaymentView({ ...r, paymentProvider: 'PAYSTACK' }, false, now).provider).toBe('PAYSTACK');
        expect(paygPaymentView({ ...r, paymentProvider: 'stripe' }, false, now).provider).toBeNull();
        expect(paygPaymentView(r, false, now).provider).toBeNull();
    });
});
