import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    getRideSettings: vi.fn(), customerBalance: vi.fn(), foundingAvailability: vi.fn(),
    findOpenRide: vi.fn(), paygStatus: vi.fn(), quotePackageRide: vi.fn(), quotePaygRide: vi.fn(),
    bookPackageRide: vi.fn(), changeRideStatus: vi.fn(), resolveConversationCustomer: vi.fn(),
}));
vi.mock('./settings.js', () => ({ getRideSettings: m.getRideSettings }));
vi.mock('./passes.js', () => ({ customerBalance: m.customerBalance, foundingAvailability: m.foundingAvailability, PASS_DISPLAY_NAME: 'Pioneer 50', passCreditMinor: (p: any) => p.creditMinor ?? p.priceMinor }));
vi.mock('./rides.js', () => ({ BOOKED_RIDE: { NOT: { kind: 'PAYG', paidAt: null } }, findOpenRide: m.findOpenRide, paygStatus: m.paygStatus, quotePackageRide: m.quotePackageRide, quotePaygRide: m.quotePaygRide }));
vi.mock('./operations.js', () => ({ bookPackageRide: m.bookPackageRide, changeRideStatus: m.changeRideStatus, resolveConversationCustomer: m.resolveConversationCustomer }));

import { createRideFlowActions, fareListText, registerRideFlowActions, resolveDestination, TURBO_ACTIONS, UNKNOWN_PLACE_TEXT } from './flow-actions.js';
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
    // A phone-keyed WhatsApp chat unless a test says otherwise.
    conversation: { findFirst: vi.fn(async () => ({ channel: 'WHATSAPP', externalId: '233241234567' })) },
};
const req = (vars: Record<string, string> = {}) => ({ tenantId: 't1', conversationId: 'conv1', customerPhone: '233241234567', name: 'x', args: {}, vars, idempotencyKey: 'k' });
const customer = { id: 'c1', name: 'Ama', email: null, phone: '+233241234567', attributes: { old: 'kept' } };
const settings = {
    timezone: 'Africa/Accra', packagePriceMinor: 96000, packageRides: 60, validityDays: 60, maxKm: 6, holdMinutes: 30, paygOpen: true, fareRef: null,
    packageFares: [{ upToKm: 6, fareMinor: 1600 }, { upToKm: 10, fareMinor: 2500 }], packageOverFareMinor: 4000,
    paygFares: [{ upToKm: 6, fareMinor: 2500 }, { upToKm: 10, fareMinor: 3500 }], paygOverFareMinor: 5000,
};
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
            pkg_price: '960', pkg_days: 60, pkg_fares: '• 0–6 km: GHS 16 (PAYG 25)\n• 6–10 km: GHS 25 (PAYG 35)\n• Over 10 km: GHS 40 (PAYG 50)',
            founding_cap: 50, founding_left: 12, founding_open: 'yes', hold_minutes: 30,
            // legacy names for the previous flow version
            pkg_rides: 60, pkg_max_km: 6, pkg_per_ride: '16',
        });
    });
    it('fare list: no PAYG fare where PAYG is not offered, no over line when the package has none', () => {
        expect(fareListText({ ...settings, paygOverFareMinor: null, packageOverFareMinor: 4000 })).toBe('• 0–6 km: GHS 16 (PAYG 25)\n• 6–10 km: GHS 25 (PAYG 35)\n• Over 10 km: GHS 40');
        expect(fareListText({ ...settings, packageOverFareMinor: null })).toBe('• 0–6 km: GHS 16 (PAYG 25)\n• 6–10 km: GHS 25 (PAYG 35)');
    });
    it('balance in GHS (what a booking may use), the open ride, and the legacy ride-count names', async () => {
        m.customerBalance.mockResolvedValue({
            active: true, pass: { creditMinor: 96000, priceMinor: 96000, ridesTotal: 60 }, purchasedMinor: 96000, usedMinor: 19200, remainingMinor: 76800, ridesTaken: 12,
            availableMinor: 75200, expiresAt: new Date('2026-12-05T12:00:00Z'),
        });
        m.findOpenRide.mockResolvedValue({ ref: 'TR-1', status: 'ASSIGNED' });
        expect((await actions['turbo.balance'](req())).vars).toEqual({
            needs_phone: 'no', member: 'yes', pass_name: 'Pioneer 50', balance: '752', balance_minor: 75200, credit_total: '960', credit_used: '192', rides_taken: 12,
            expiry_date: '5 Dec 2026', open_ride: 'yes', open_ride_ref: 'TR-1', open_ride_status: 'assigned to a driver',
            rides_total: 60, rides_used: 12, rides_left: 47,
        });
    });
    it('an exhausted balance reads 0 (and legacy rides_left 0)', async () => {
        m.customerBalance.mockResolvedValue({ active: true, pass: { creditMinor: 96000, priceMinor: 96000, ridesTotal: 60 }, purchasedMinor: 96000, usedMinor: 96000, remainingMinor: 0, ridesTaken: 60, availableMinor: 0, expiresAt: null });
        m.findOpenRide.mockResolvedValue(null);
        expect((await actions['turbo.balance'](req())).vars).toMatchObject({ balance: '0', balance_minor: 0, rides_left: 0 });
    });
    it('payg_open is the switch; payg_reason says why it cannot be booked', async () => {
        m.paygStatus.mockResolvedValue({ open: false, reason: 'full', available: 0, fromFareMinor: 2500 });
        expect((await actions['turbo.payg_open'](req())).vars).toEqual({ payg_open: 'yes', payg_reason: 'full', payg_fare_from: '25', payg_left: 0, hold_minutes: 30 });
    });
    it('no customer resolvable: ok false (the flow goes to its error state)', async () => {
        m.resolveConversationCustomer.mockResolvedValue(null);
        expect(await actions['turbo.balance'](req())).toEqual({ ok: false });
    });
    it('no customer because WhatsApp hides the number (BSUID chat): needs_phone, not an error', async () => {
        m.resolveConversationCustomer.mockResolvedValue(null);
        prisma.conversation.findFirst.mockResolvedValueOnce({ channel: 'WHATSAPP', externalId: 'GH.1234567890123456' });
        expect(await actions['turbo.balance'](req())).toEqual({ ok: true, vars: { needs_phone: 'yes', member: 'no', open_ride: 'no' } });
    });
});

describe('turbo.quote_ride / turbo.payg_quote', () => {
    it('unknown place asks again', async () => {
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: 'nowhere' }))).vars).toEqual({ quote_ok: 'no', quote_code: 'unknown_place', quote_reason: UNKNOWN_PLACE_TEXT });
    });
    const okQuote = (settlement: Record<string, unknown>, available = 96000) => ({
        ok: true, passId: 'p1', availableMinor: available, settlement, priceDistanceKm: 0.46, basis: 'PICKUP', band: '0–6 km', fareMinor: 1600,
    });
    it('balance covers it: fare, band and the balance before -> after', async () => {
        m.quotePackageRide.mockResolvedValue(okQuote({ mode: 'balance', balanceAppliedMinor: 1600, topupMinor: 0, waivedMinor: 0, balanceAfterMinor: 94400 }));
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '2' }))).vars).toEqual({
            quote_ok: 'yes', quote_code: 'ok', quote_reason: '', trip_dest: 'Library', trip_dest_lat: '5.6537', trip_dest_lng: '-0.1861', trip_dest_id: 'd2', trip_km: '0.5',
            pkg_fare: '16', fare_band: '0–6 km', pay_mode: 'balance', balance: '960', balance_after: '944', balance_use: '16', topup_amount: '',
            balance_line: 'Balance: GHS 960 → GHS 944', hold_minutes: 30, rides_left: 60,
        });
    });
    it('the pickup is optional when fares run from the reference point (destination first)', async () => {
        m.quotePackageRide.mockResolvedValue(okQuote({ mode: 'balance', balanceAppliedMinor: 1600, topupMinor: 0, waivedMinor: 0, balanceAfterMinor: 94400 }));
        expect((await actions['turbo.quote_ride'](req({ dest_text: '2' }))).vars).toMatchObject({ quote_ok: 'yes', pkg_fare: '16' });
        expect(m.quotePackageRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pickup: null, destination: expect.objectContaining({ id: 'd2' }) }));
    });
    it('waive (difference under GHS 2) and top-up (pay the difference)', async () => {
        m.quotePackageRide.mockResolvedValue(okQuote({ mode: 'waive', balanceAppliedMinor: 1450, topupMinor: 0, waivedMinor: 150, balanceAfterMinor: 0 }, 1450));
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '2' }))).vars).toMatchObject({
            pay_mode: 'waive', balance_use: '14.50', balance_after: '0', topup_amount: '', balance_line: "Balance: GHS 14.50 → GHS 0 (we've covered the last GHS 1.50)",
        });
        m.quotePackageRide.mockResolvedValue(okQuote({ mode: 'topup', balanceAppliedMinor: 1000, topupMinor: 600, waivedMinor: 0, balanceAfterMinor: 0 }, 1000));
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '2' }))).vars).toMatchObject({ pay_mode: 'topup', balance_use: '10', topup_amount: '6' });
    });
    it('no balance offers PAYG; a distance with no package fare is explained', async () => {
        m.quotePackageRide.mockResolvedValue({ ok: false, reason: 'no_balance', availableMinor: 0, fareMinor: 1600, priceDistanceKm: 2 });
        expect((await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '1' }))).vars).toMatchObject({ quote_ok: 'no', quote_code: 'no_balance', quote_reason: expect.stringMatching(/no ride credit left[\s\S]*PAYG/) });
        m.quotePackageRide.mockResolvedValue({ ok: false, reason: 'not_offered', priceDistanceKm: 12.62, maxKm: 10 });
        const v = (await actions['turbo.quote_ride'](req({ ...pickup, dest_text: '1' }))).vars!;
        expect(v).toMatchObject({ quote_ok: 'no', quote_code: 'not_offered' });
        expect(v.quote_reason).toMatch(/about 12\.6 km\. Package rides go up to 10 km/);
    });
    it('the unknown-place text tells the customer how to send a pin', () => {
        expect(UNKNOWN_PLACE_TEXT).toBe("I couldn't find that place. 📍 Please send it as a location pin: tap 📎 (or +) → Location → search for the place → tap it to send. Or reply with a number from the list.");
    });
    it('PAYG: fare, or TURBO\'s "slots filled" text', async () => {
        m.quotePaygRide.mockResolvedValue({ ok: true, priceDistanceKm: 1, basis: 'PICKUP', band: '0–6 km', fareMinor: 2500, currency: 'GHS' });
        m.paygStatus.mockResolvedValue({ open: true, reason: 'open' });
        expect((await actions['turbo.payg_quote'](req({ ...pickup, dest_text: 'library' }))).vars).toMatchObject({ quote_ok: 'yes', payg_fare: '25', fare_band: '0–6 km', trip_dest: 'Library' });
        m.paygStatus.mockResolvedValue({ open: false, reason: 'full' });
        expect((await actions['turbo.payg_quote'](req({ ...pickup, dest_text: 'library' }))).vars).toMatchObject({ quote_ok: 'no', quote_code: 'full', quote_reason: expect.stringMatching(/^🔴 PAYG is currently unavailable/) });
    });
});

describe('turbo.request_ride', () => {
    const trip = { ...pickup, trip_dest: 'Library', trip_dest_lat: '5.6537', trip_dest_lng: '-0.1861', trip_dest_id: 'd2' };
    it('books through the operation (WhatsApp source, this conversation)', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: true, ride: { ref: 'TR-9' }, settlement: { mode: 'balance' } });
        expect((await actions['turbo.request_ride'](req({ ...trip, pkg_fare: '16' }))).vars).toEqual({ request_ok: 'yes', request_reason: '', ride_ref: 'TR-9' });
        expect(m.bookPackageRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            customerId: 'c1', conversationId: 'conv1', source: 'WHATSAPP', destination: expect.objectContaining({ id: 'd2' }), expectedFareMinor: 1600,
        }));
    });
    it('a fare that changed since the quote is not booked (fare_changed re-quote)', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'fare_changed', fareMinor: 2500 });
        expect((await actions['turbo.request_ride'](req({ ...trip, pkg_fare: '16' }))).vars).toMatchObject({ request_ok: 'no', request_reason: expect.stringMatching(/now GHS 25\. Nothing was booked/) });
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
        m.changeRideStatus.mockResolvedValue({ ok: true, changed: true, refundDue: false, refundMinor: null });
        expect((await actions['turbo.cancel_ride'](req())).vars).toEqual({ cancel_ok: 'yes', cancel_reason: '❌ Ride TR-1 cancelled. Nothing was deducted from your balance.' });
        m.changeRideStatus.mockResolvedValue({ ok: true, changed: true, refundDue: true, refundMinor: 600 });
        expect((await actions['turbo.cancel_ride'](req())).vars!.cancel_reason).toMatch(/payment of GHS 6 will be refunded/);
        expect(m.changeRideStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rideId: 'r1', status: 'CANCELLED', by: 'customer' }));
    });
    it('history and account text', async () => {
        expect((await actions['turbo.history'](req())).vars).toEqual({ history_text: 'No rides yet.', history_count: 0 });
        m.customerBalance.mockResolvedValue({ active: false, remainingMinor: 0, availableMinor: 0, expiresAt: null });
        expect((await actions['turbo.account'](req())).vars).toMatchObject({ account_name: 'Ama', account_phone: '+233241234567', account_email: '-', package_status: 'No active package' });
    });
    it('destinations as one numbered block', async () => {
        expect((await actions['turbo.destinations'](req())).vars).toEqual({
            destination_menu: "Reply with a number:\n1. Main Gate\n2. Library\n3. Library Annex\n\nOr share the destination's location pin.", dest_count: 3, fare_ref: 'no',
        });
        m.getRideSettings.mockResolvedValue({ ...settings, fareRef: { label: 'Student Plaza', lat: 5.62, lng: -0.17 } });
        expect((await actions['turbo.destinations'](req())).vars!.fare_ref).toBe('yes');
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
