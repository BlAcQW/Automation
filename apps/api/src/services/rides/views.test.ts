import { describe, it, expect } from 'vitest';
import { balanceLogView, customerSummary, currentPass, packagePaymentStatus, passStatusOf, passView, paygPaymentStatus, rideView } from './views.js';

const now = new Date('2026-10-06T12:00:00Z');
const pass = (over: Record<string, unknown> = {}) => ({
    id: 'p1', tenantId: 't1', customerId: 'c1', conversationId: null, status: 'ACTIVE', ridesTotal: 60, validityDays: 60, maxKm: 6,
    priceMinor: 96000, currency: 'GHS', holdExpiresAt: null, activatedAt: now, expiresAt: new Date('2026-12-05T12:00:00Z'),
    paymentReference: 'ref', paidAt: now, paidAmountMinor: 96000, cancelledAt: null, cancelReason: null,
    expiryReminderSentAt: null, lowBalanceReminderSentAt: null, createdAt: now, updatedAt: now, ...over,
}) as any;

describe('pass status as the console shows it', () => {
    it('maps HELD to PENDING_PAYMENT and an empty ACTIVE pass to EXHAUSTED', () => {
        expect(passStatusOf({ status: 'HELD' }, 0)).toBe('PENDING_PAYMENT');
        expect(passStatusOf({ status: 'ACTIVE' }, 3)).toBe('ACTIVE');
        expect(passStatusOf({ status: 'ACTIVE' }, 0)).toBe('EXHAUSTED');
        expect(passStatusOf({ status: 'EXPIRED' }, 0)).toBe('EXPIRED');
        expect(passStatusOf({ status: 'CANCELLED' }, 0)).toBe('CANCELLED');
    });

    it('passView carries name, money string and ride counts', () => {
        expect(passView(pass(), { purchased: 60, used: 12, remaining: 48 })).toEqual({
            id: 'p1', name: 'Pioneer 50', status: 'ACTIVE', price: '960.00', ridesTotal: 60, ridesUsed: 12, ridesRemaining: 48,
            activatedAt: now, expiresAt: new Date('2026-12-05T12:00:00Z'), createdAt: now,
        });
        expect(passView(pass({ status: 'HELD', activatedAt: null }), undefined).ridesRemaining).toBe(0);
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
        const s = customerSummary(c, [pass()], new Map([['p1', { purchased: 60, used: 1, remaining: 59 }]]), true);
        expect(s).toMatchObject({ id: 'c1', studentId: '2021', university: 'CU', balance: 59, package: { id: 'p1', name: 'Pioneer 50', status: 'ACTIVE' } });
        expect(s.phone).not.toBe(c.phone);
        expect(customerSummary(c, [], new Map(), false)).toMatchObject({ phone: c.phone, package: null, balance: null, expiresAt: null });
    });
    it('never trusts attributes JSON', () => {
        expect(customerSummary({ ...c, attributes: ['x'] }, [], new Map(), false)).toMatchObject({ studentId: null, university: null });
    });
});

describe('balanceLogView', () => {
    it('renames PURCHASE to ACTIVATION, adds the running balance per pass, newest first', () => {
        const e = (id: string, type: string, delta: number, at: string, rideId: string | null = null, passId = 'p1') =>
            ({ id, tenantId: 't1', passId, type, delta, rideId, reference: null, note: null, createdAt: new Date(at) }) as any;
        const out = balanceLogView([
            e('3', 'RIDE', -1, '2026-10-03', 'r2'), e('1', 'PURCHASE', 60, '2026-10-01'), e('2', 'RIDE', -1, '2026-10-02', 'r1'), e('4', 'PURCHASE', 60, '2026-10-02', null, 'p2'),
        ], new Map([['r1', 'TR-1'], ['r2', 'TR-2']]));
        expect(out.map((x) => [x.id, x.reason, x.balanceAfter, x.rideRef])).toEqual([
            ['3', 'RIDE', 58, 'TR-2'], ['4', 'ACTIVATION', 60, null], ['2', 'RIDE', 59, 'TR-1'], ['1', 'ACTIVATION', 60, null],
        ]);
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
        destinationLabel: 'Library', destinationLat: 3, destinationLng: 4, distanceKm: 1.25, fareMinor: 0,
        requestedAt: now, assignedAt: now, completedAt: null, cancelledAt: null, cancelReason: null,
        customer: { id: 'c1', name: 'Ama', phone: '+233241234567' },
        driver: { id: 'd1', name: 'Kofi', vehicle: 'Vitz', plate: 'GR 1', phone: '+233200000000' },
    } as any;
    it('package rides have fare null; the driver phone is not exposed', () => {
        expect(rideView(base, false)).toEqual({
            id: 'r1', ref: 'TR-1', kind: 'PACKAGE', status: 'ASSIGNED', customer: { id: 'c1', name: 'Ama', phone: '+233241234567' },
            pickup: { label: 'Gate', lat: 1, lng: 2 }, destination: { label: 'Library', lat: 3, lng: 4 }, distanceKm: 1.25, fare: null,
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
});
