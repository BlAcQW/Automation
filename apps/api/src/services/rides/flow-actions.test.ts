import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    getRideSettings: vi.fn(), customerBalance: vi.fn(), foundingAvailability: vi.fn(),
    findOpenRide: vi.fn(), paygStatus: vi.fn(), quotePackageRide: vi.fn(), quotePaygRide: vi.fn(),
    bookPackageRide: vi.fn(), changeRideStatus: vi.fn(), resolveConversationCustomer: vi.fn(),
}));
vi.mock('./settings.js', () => ({ getRideSettings: m.getRideSettings }));
vi.mock('./passes.js', () => ({ customerBalance: m.customerBalance, foundingAvailability: m.foundingAvailability, PASS_DISPLAY_NAME: 'Pioneer 50' }));
vi.mock('./rides.js', () => ({ BOOKED_RIDE: { NOT: { kind: 'PAYG', paidAt: null } }, findOpenRide: m.findOpenRide, paygStatus: m.paygStatus, quotePackageRide: m.quotePackageRide, quotePaygRide: m.quotePaygRide }));
vi.mock('./operations.js', () => ({ bookPackageRide: m.bookPackageRide, changeRideStatus: m.changeRideStatus, resolveConversationCustomer: m.resolveConversationCustomer }));

import { createRideFlowActions, registerRideFlowActions, resolveDestination, TURBO_ACTIONS, UNKNOWN_PLACE_TEXT } from './flow-actions.js';
import { isRegisteredFlowAction, resetFlowActionsForTests } from '../flows/actions.js';

const dests = [
    { id: 'd1', label: 'Main Gate', latitude: 5.6505, longitude: -0.1873 },
    { id: 'd2', label: 'Library', latitude: 5.6537, longitude: -0.1861 },
    { id: 'd3', label: 'Library Annex', latitude: 5.654, longitude: -0.186 },
];
const prisma: any = {
    rideDestination: { findMany: vi.fn(async () => dests) },
    customer: { updateMany: vi.fn(async () => ({ count: 1 })) },
    ride: { findMany: vi.fn(async () => []) },
};
const req = (vars: Record<string, string> = {}) => ({ tenantId: 't1', conversationId: 'conv1', customerPhone: '233241234567', name: 'x', args: {}, vars, idempotencyKey: 'k' });
const customer = { id: 'c1', name: 'Ama', email: null, phone: '+233241234567', attributes: { old: 'kept' } };
const settings = { timezone: 'Africa/Accra', packagePriceMinor: 96000, packageRides: 60, validityDays: 60, maxKm: 6, holdMinutes: 30, paygOpen: true };
const actions = createRideFlowActions(prisma);
const pickup = { pickup_lat: '5.6505', pickup_lng: '-0.1873', pickup_label: 'Main Gate' };

beforeEach(() => {
    vi.clearAllMocks();
    m.resolveConversationCustomer.mockResolvedValue(customer);
    m.getRideSettings.mockResolvedValue(settings);
});

describe('resolveDestination', () => {
    it('a pin wins; else a list number; else an exact or unique partial label', async () => {
        expect(await resolveDestination(prisma, 't1', { dest_lat: '5.7', dest_lng: '-0.1', dest_label: 'Mall' })).toEqual({ label: 'Mall', lat: 5.7, lng: -0.1 });
        expect(await resolveDestination(prisma, 't1', { dest_text: '2' })).toMatchObject({ id: 'd2', label: 'Library' });
        expect(await resolveDestination(prisma, 't1', { dest_text: 'library' })).toMatchObject({ id: 'd2' });
        expect(await resolveDestination(prisma, 't1', { dest_text: 'gate' })).toMatchObject({ id: 'd1' });
        expect(await resolveDestination(prisma, 't1', { dest_text: 'lib' })).toBeNull(); // ambiguous
        expect(await resolveDestination(prisma, 't1', { dest_text: '9' })).toBeNull();
        expect(await resolveDestination(prisma, 't1', { dest_lat: '95', dest_lng: '0' })).toBeNull();
        expect(await resolveDestination(prisma, 't1', {})).toBeNull();
    });
});

describe('turbo.register', () => {
    it('saves name, email, student id and university on the Customer (merging attributes)', async () => {
        const r = await actions['turbo.register'](req({ full_name: 'Ama Mensah', student_id: '20211234', university: 'Central University', email: 'Ama@Example.com' }));
        expect(r).toEqual({ ok: true, vars: { customer_name: 'Ama Mensah', welcome_name: 'AMA MENSAH' } });
        expect(prisma.customer.updateMany).toHaveBeenCalledWith({
            where: { id: 'c1', tenantId: 't1' },
            data: { name: 'Ama Mensah', email: 'ama@example.com', attributes: { old: 'kept', studentId: '20211234', university: 'Central University' } },
        });
    });
    it('refuses incomplete answers', async () => {
        expect(await actions['turbo.register'](req({ full_name: 'Ama' }))).toEqual({ ok: false });
    });
});

describe('turbo.founding_available / balance / payg_open', () => {
    it('package numbers for the copy', async () => {
        m.foundingAvailability.mockResolvedValue({ cap: 50, taken: 38, left: 12, available: true });
        expect((await actions['turbo.founding_available'](req())).vars).toEqual({
            pkg_price: '960', pkg_rides: 60, pkg_days: 60, pkg_max_km: 6, pkg_per_ride: '16', founding_cap: 50, founding_left: 12, founding_open: 'yes', hold_minutes: 30,
        });
    });
    it('balance and the open ride', async () => {
        m.customerBalance.mockResolvedValue({ active: true, purchased: 60, used: 12, remaining: 48, expiresAt: new Date('2026-12-05T12:00:00Z') });
        m.findOpenRide.mockResolvedValue({ ref: 'TR-1', status: 'ASSIGNED' });
        expect((await actions['turbo.balance'](req())).vars).toEqual({
            member: 'yes', pass_name: 'Pioneer 50', rides_total: 60, rides_used: 12, rides_left: 48, expiry_date: '5 Dec 2026',
            open_ride: 'yes', open_ride_ref: 'TR-1', open_ride_status: 'assigned to a driver',
        });
    });
    it('payg_open is the switch; payg_reason says why it cannot be booked', async () => {
        m.paygStatus.mockResolvedValue({ open: false, reason: 'full', available: 0, fromFareMinor: 2500 });
        expect((await actions['turbo.payg_open'](req())).vars).toEqual({ payg_open: 'yes', payg_reason: 'full', payg_fare_from: '25', payg_left: 0, hold_minutes: 30 });
    });
    it('no customer resolvable: ok false (the flow goes to its error state)', async () => {
        m.resolveConversationCustomer.mockResolvedValue(null);
        expect(await actions['turbo.balance'](req())).toEqual({ ok: false });
    });
});

describe('turbo.quote_ride / turbo.payg_quote', () => {
    it('unknown place asks again', async () => {
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: 'nowhere' }))).vars).toEqual({ quote_ok: 'no', quote_code: 'unknown_place', quote_reason: UNKNOWN_PLACE_TEXT });
    });
    it('eligible trip: the resolved destination goes into trip_* variables', async () => {
        m.quotePackageRide.mockResolvedValue({ ok: true, distanceKm: 0.46, remaining: 48, passId: 'p1' });
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '2' }))).vars).toEqual({
            quote_ok: 'yes', quote_code: 'ok', quote_reason: '', trip_dest: 'Library', trip_dest_lat: '5.6537', trip_dest_lng: '-0.1861', trip_dest_id: 'd2', trip_km: '0.5', rides_left: 48,
        });
    });
    it('too far is explained with the distance and the limit', async () => {
        m.quotePackageRide.mockResolvedValue({ ok: false, reason: 'too_far', distanceKm: 8.62, maxKm: 6, remaining: 48 });
        const v = (await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '1' }))).vars!;
        expect(v).toMatchObject({ quote_ok: 'no', quote_code: 'too_far' });
        expect(v.quote_reason).toMatch(/about 8\.6 km\. Founding Package rides cover 0–6 km/);
    });
    it('PAYG: fare, or TURBO\'s "slots filled" text', async () => {
        m.quotePaygRide.mockResolvedValue({ ok: true, distanceKm: 1, fareMinor: 2500, currency: 'GHS' });
        m.paygStatus.mockResolvedValue({ open: true, reason: 'open' });
        expect((await actions['turbo.payg_quote'](req({ ...pickup, dest_text: 'library' }))).vars).toMatchObject({ quote_ok: 'yes', payg_fare: '25', trip_dest: 'Library' });
        m.paygStatus.mockResolvedValue({ open: false, reason: 'full' });
        expect((await actions['turbo.payg_quote'](req({ ...pickup, dest_text: 'library' }))).vars).toMatchObject({ quote_ok: 'no', quote_code: 'full', quote_reason: expect.stringMatching(/^🔴 PAYG is currently unavailable/) });
    });
});

describe('turbo.request_ride', () => {
    const trip = { ...pickup, trip_dest: 'Library', trip_dest_lat: '5.6537', trip_dest_lng: '-0.1861', trip_dest_id: 'd2' };
    it('books through the operation (WhatsApp source, this conversation)', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: true, ride: { ref: 'TR-9' }, remaining: 48 });
        expect((await actions['turbo.request_ride'](req(trip))).vars).toEqual({ request_ok: 'yes', request_reason: '', ride_ref: 'TR-9' });
        expect(m.bookPackageRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerId: 'c1', conversationId: 'conv1', source: 'WHATSAPP', destination: expect.objectContaining({ id: 'd2' }) }));
    });
    it('a re-run of the same turn reports the ride it already made instead of refusing it', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'open_ride' });
        m.findOpenRide.mockResolvedValue({ ref: 'TR-9', status: 'REQUESTED', conversationId: 'conv1', pickupLat: 5.6505, pickupLng: -0.1873, destinationLat: 5.6537, destinationLng: -0.1861 });
        expect((await actions['turbo.request_ride'](req(trip))).vars).toMatchObject({ request_ok: 'yes', ride_ref: 'TR-9' });
        m.findOpenRide.mockResolvedValue({ ref: 'TR-1', status: 'ASSIGNED', conversationId: 'conv1', pickupLat: 0, pickupLng: 0, destinationLat: 0, destinationLng: 0 });
        expect((await actions['turbo.request_ride'](req(trip))).vars).toMatchObject({ request_ok: 'no', request_reason: 'You already have a ride in progress (TR-1).' });
    });
    it('without a trip in the variables it fails (error state)', async () => {
        expect(await actions['turbo.request_ride'](req(pickup))).toEqual({ ok: false });
    });
});

describe('turbo.cancel_ride / history / account / destinations', () => {
    it('cancels only a ride still waiting for a driver', async () => {
        m.findOpenRide.mockResolvedValue({ id: 'r1', ref: 'TR-1', status: 'ASSIGNED' });
        expect((await actions['turbo.cancel_ride'](req())).vars).toMatchObject({ cancel_ok: 'no' });
        m.findOpenRide.mockResolvedValue({ id: 'r1', ref: 'TR-1', status: 'REQUESTED' });
        m.changeRideStatus.mockResolvedValue({ ok: true, changed: true, refundDue: false });
        expect((await actions['turbo.cancel_ride'](req())).vars).toEqual({ cancel_ok: 'yes', cancel_reason: '❌ Ride TR-1 cancelled. No ride was deducted.' });
        expect(m.changeRideStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rideId: 'r1', status: 'CANCELLED', by: 'customer' }));
    });
    it('history and account text', async () => {
        expect((await actions['turbo.history'](req())).vars).toEqual({ history_text: 'No rides yet.', history_count: 0 });
        m.customerBalance.mockResolvedValue({ active: false, remaining: 0, expiresAt: null });
        expect((await actions['turbo.account'](req())).vars).toMatchObject({ account_name: 'Ama', account_phone: '+233241234567', account_email: '-', package_status: 'No active package' });
    });
    it('destinations as one numbered block', async () => {
        expect((await actions['turbo.destinations'](req())).vars).toEqual({
            destination_menu: "Reply with a number:\n1. Main Gate\n2. Library\n3. Library Annex\n\nOr share the destination's location pin.", dest_count: 3,
        });
    });
});

describe('registerRideFlowActions', () => {
    it('registers every turbo.* action once (safe to call again)', () => {
        resetFlowActionsForTests();
        registerRideFlowActions(prisma);
        registerRideFlowActions(prisma);
        expect(TURBO_ACTIONS.every((a) => isRegisteredFlowAction(a))).toBe(true);
    });
});
