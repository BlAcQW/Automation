/**
 * RIDES pack on a real database: the races the design depends on, the balance
 * log invariants, the sweeper, and every console query against the real
 * schema (inside a tenant context, so the tenant guard is live).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/arkesel.js', async (orig) => ({ ...(await orig<object>()), sendSms: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../src/services/gmail-smtp.js', async (orig) => ({ ...(await orig<object>()), sendEmail: vi.fn(async () => ({ ok: true })) }));

import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedTenant } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { silentLogger } from './helpers/fake-fastify.js';
import { tenantContext } from '../../src/lib/tenant-context.js';
import { activatePassOnPayment, customerBalance, foundingAvailability, holdFoundingSlot, passBalance } from '../../src/services/rides/passes.js';
import { reservePaygRide, requestPackageRide, setRideStatus, assignDriver, confirmPaygOnPayment, paygStatus, reserveTopupRide, confirmTopupOnPayment } from '../../src/services/rides/rides.js';
import { paygDayKey } from '../../src/services/rides/capacity.js';
import { sweepRides } from '../../src/services/rides/sweeper.js';
import { fulfillRidePackage, fulfillRidePayg, fulfillRideTopup } from '../../src/services/rides/payments.js';
import { customerDetail, customerList, liveRides, overview, passList, paymentList, rideHistory } from '../../src/services/rides/console.js';
import { updateRideSettings, getRideSettings } from '../../src/services/rides/settings.js';

const GATE = { label: 'Main Gate', lat: 5.6505, lng: -0.1873 };
const LIBRARY = { label: 'Library', lat: 5.6537, lng: -0.1861 }; // ~0.4 km
const FAR = { label: 'Airport', lat: 5.6052, lng: -0.1668 }; // ~6.6 km straight, ~8.6 km road

let tenantId: string;
let seq = 0;
const db = () => guardedPrisma();
const inTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ tenantId, userId: 'u1' }, fn);

async function customer(name = `Rider ${++seq}`) {
    return rawPrisma().customer.create({ data: { tenantId, phone: `+23324${String(1000000 + ++seq).slice(-7)}`, name } });
}

async function activePass(customerId: string, over: Record<string, unknown> = {}) {
    const prisma = await db();
    const hold = await holdFoundingSlot(prisma, { tenantId, customerId });
    if (!hold.ok) throw new Error(hold.reason);
    const ref = `ref_${hold.pass.id}`;
    const a = await activatePassOnPayment(prisma, { tenantId, passId: hold.pass.id, reference: ref, amountMinor: 96000, currency: 'GHS' });
    if (a.outcome !== 'activated') throw new Error(a.outcome);
    if (Object.keys(over).length) await rawPrisma().ridePass.update({ where: { id: hold.pass.id }, data: over });
    return a.pass;
}

describe('RIDES pack on a real database', () => {
beforeEach(async () => {
    tenantId = (await seedTenant({ vertical: 'RIDES', monthlyMessageQuotaOverride: 10_000 })).id;
    vi.clearAllMocks();
});

describe('Founding cap with holds', () => {
    it('two (or eight) customers racing for the 50th slot: exactly one gets it', async () => {
        const prisma = await db();
        const owners = await Promise.all(Array.from({ length: 49 }, () => customer()));
        await rawPrisma().ridePass.createMany({
            data: owners.map((c) => ({ tenantId, customerId: c.id, status: 'ACTIVE' as const, ridesTotal: 60, validityDays: 60, maxKm: 6, priceMinor: 96000, currency: 'GHS', activatedAt: new Date(), expiresAt: new Date(Date.now() + 86400_000) })),
        });
        const racers = await Promise.all(Array.from({ length: 8 }, () => customer()));
        const { ok, failed } = await race(8, (i) => holdFoundingSlot(prisma, { tenantId, customerId: racers[i].id }));
        expect(failed).toEqual([]);
        expect(ok.filter((r) => r.ok)).toHaveLength(1);
        expect(ok.filter((r) => !r.ok && r.reason === 'sold_out')).toHaveLength(7);
        expect((await foundingAvailability(prisma, tenantId)).left).toBe(0);
    });

    it('asking again re-uses the customer\'s own hold (never a second slot)', async () => {
        const prisma = await db();
        await updateRideSettings(prisma, tenantId, { package: { cap: 1 } });
        const c = await customer();
        const a = await holdFoundingSlot(prisma, { tenantId, customerId: c.id });
        const b = await holdFoundingSlot(prisma, { tenantId, customerId: c.id });
        expect(a.ok && b.ok && a.pass.id === b.pass.id && b.reused).toBe(true);
        expect(await rawPrisma().ridePass.count({ where: { tenantId } })).toBe(1);
        const other = await holdFoundingSlot(prisma, { tenantId, customerId: (await customer()).id });
        expect(other).toEqual({ ok: false, reason: 'sold_out' });
    });

    it('"Only 50 Founding Packages": an expired (or cancelled-after-use) package still counts, so expiry never reopens a slot', async () => {
        const prisma = await db();
        await updateRideSettings(prisma, tenantId, { package: { cap: 2 } });
        const a = await customer(); const b = await customer();
        await activePass(a.id, { status: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) });
        await activePass(b.id);
        expect((await foundingAvailability(prisma, tenantId)).left).toBe(0);
        expect(await holdFoundingSlot(prisma, { tenantId, customerId: (await customer()).id })).toEqual({ ok: false, reason: 'sold_out' });
        const o: any = await inTenant(() => overview(prisma as any, tenantId));
        expect(o.packages).toMatchObject({ sold: 2, cap: 2, slotsLeft: 0 });
    });

    it('slot squatting: 3 unpaid holds that lapse in 24h block a 4th; asking again during a live hold is free', async () => {
        const prisma = await db();
        const c = await customer();
        let t = Date.now();
        for (let i = 0; i < 3; i += 1) {
            const live = await holdFoundingSlot(prisma, { tenantId, customerId: c.id, now: new Date(t) });
            const again = await holdFoundingSlot(prisma, { tenantId, customerId: c.id, now: new Date(t + 60_000) });
            expect(live.ok && again.ok && again.reused).toBe(true);
            t += 31 * 60_000; // the hold lapses unpaid
            if (i === 1) await sweepRides(prisma, silentLogger, new Date(t)); // swept or not, it counts
        }
        expect(await holdFoundingSlot(prisma, { tenantId, customerId: c.id, now: new Date(t) })).toEqual({ ok: false, reason: 'hold_limit' });
        expect((await holdFoundingSlot(prisma, { tenantId, customerId: c.id, now: new Date(t + 25 * 3600_000) })).ok).toBe(true);
    });

    it('a customer with an active package cannot hold another', async () => {
        const prisma = await db();
        const c = await customer();
        await activePass(c.id);
        expect(await holdFoundingSlot(prisma, { tenantId, customerId: c.id })).toEqual({ ok: false, reason: 'has_active' });
    });
});

describe('activation (only on verified money, idempotent)', () => {
    it('eight concurrent deliveries of one reference: one activation, one +60 entry', async () => {
        const prisma = await db();
        const c = await customer();
        const hold = await holdFoundingSlot(prisma, { tenantId, customerId: c.id });
        if (!hold.ok) throw new Error('hold');
        const { ok, failed } = await race(8, () => activatePassOnPayment(prisma, { tenantId, passId: hold.pass.id, reference: 'ref_dup', amountMinor: 96000, currency: 'GHS' }));
        expect(failed).toEqual([]);
        expect(ok.filter((r) => r.outcome === 'activated')).toHaveLength(1);
        expect(ok.filter((r) => r.outcome === 'already_activated')).toHaveLength(7);
        expect(await rawPrisma().ridePassEntry.count({ where: { passId: hold.pass.id } })).toBe(1);
        expect(await passBalance(prisma, tenantId, hold.pass.id)).toEqual({ purchasedMinor: 96000, usedMinor: 0, remainingMinor: 96000, ridesTaken: 0 });
        const pass = await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: hold.pass.id } });
        expect(pass.status).toBe('ACTIVE');
        expect(pass.expiresAt!.getTime() - pass.activatedAt!.getTime()).toBe(60 * 86400_000);
    });

    it('underpaid money activates nothing', async () => {
        const prisma = await db();
        const c = await customer();
        const hold = await holdFoundingSlot(prisma, { tenantId, customerId: c.id });
        if (!hold.ok) throw new Error('hold');
        const r = await activatePassOnPayment(prisma, { tenantId, passId: hold.pass.id, reference: 'ref_low', amountMinor: 50000, currency: 'GHS' });
        expect(r.outcome).toBe('underpaid');
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: hold.pass.id } })).status).toBe('HELD');
    });

    it('late payment after the hold lapsed and the cap filled: NOT activated, recorded, critical alert + staff notice (fulfiller)', async () => {
        const prisma = await db();
        await updateRideSettings(prisma, tenantId, { package: { cap: 1 } });
        const late = await customer();
        const hold = await holdFoundingSlot(prisma, { tenantId, customerId: late.id });
        if (!hold.ok) throw new Error('hold');
        await rawPrisma().ridePass.update({ where: { id: hold.pass.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
        await activePass((await customer()).id); // takes the only slot

        const input = { prisma, tenantId, entityId: hold.pass.id, reference: 'ref_late', amountMinor: 96000, currency: 'GHS', log: silentLogger };
        const out = await fulfillRidePackage(input);
        expect(out).toEqual({ status: 'rejected', reason: 'not_activated:cap_full' });
        const pass = await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: hold.pass.id } });
        expect(pass).toMatchObject({ status: 'CANCELLED', cancelReason: 'cap_full_after_hold', paymentReference: 'ref_late', paidAmountMinor: 96000 });
        expect(pass.activatedAt).toBeNull();
        expect(await rawPrisma().ridePassEntry.count({ where: { passId: pass.id } })).toBe(0);
        const alerts = await rawPrisma().platformAlert.findMany({ where: { tenantId, kind: 'ride_package.not_applied' } });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].severity).toBe('critical');
        expect(await rawPrisma().notification.count({ where: { tenantId, title: 'Payment needs a refund' } })).toBe(1);
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'payment.succeeded', dedupeKey: 'payment.succeeded:reference:ref_late' } })).toBe(1);

        // Redelivery: same verdict, nothing new.
        expect(await fulfillRidePackage(input)).toEqual({ status: 'rejected', reason: 'not_activated:cap_full_after_hold' });
        expect(await rawPrisma().notification.count({ where: { tenantId, title: 'Payment needs a refund' } })).toBe(1);
    });

    it('late payment after the hold lapsed while a slot is still free: activated', async () => {
        const prisma = await db();
        const c = await customer();
        const hold = await holdFoundingSlot(prisma, { tenantId, customerId: c.id });
        if (!hold.ok) throw new Error('hold');
        await sweepRides(prisma, silentLogger, new Date(Date.now() + 31 * 60_000)); // hold swept to CANCELLED
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: hold.pass.id } })).status).toBe('CANCELLED');
        const out = await fulfillRidePackage({ prisma, tenantId, entityId: hold.pass.id, reference: 'ref_ok', amountMinor: 96000, currency: 'GHS', log: silentLogger });
        expect(out).toEqual({ status: 'applied' });
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: hold.pass.id } })).status).toBe('ACTIVE');
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'ride_pass.activated' } })).toBe(1);
    });
});

describe('ride lifecycle: deduct only on COMPLETED, exactly once', () => {
    it('a double (octuple) COMPLETED click deducts the band fare once: GHS 960 -> 944', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        const req = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        if (!req.ok) throw new Error(req.reason);
        const driver = await rawPrisma().driver.create({ data: { tenantId, name: 'Kofi', phone: '+233200000001', vehicle: 'Toyota Vitz', plate: 'GR 1234-24' } });
        expect((await assignDriver(prisma, { tenantId, rideId: req.ride.id, driverId: driver.id })).ok).toBe(true);
        const { ok, failed } = await race(8, () => setRideStatus(prisma, { tenantId, rideId: req.ride.id, status: 'COMPLETED' }));
        expect(failed).toEqual([]);
        const changed = ok.filter((r) => r.ok && r.changed);
        expect(changed).toHaveLength(1);
        expect(ok.filter((r) => r.ok && !r.changed)).toHaveLength(7);
        expect(await rawPrisma().ridePassEntry.count({ where: { passId: pass.id, type: 'RIDE' } })).toBe(1);
        expect((await passBalance(prisma, tenantId, pass.id)).remainingMinor).toBe(94400);
        expect(await rawPrisma().ride.findUniqueOrThrow({ where: { id: req.ride.id } })).toMatchObject({
            fareMinor: 1600, balanceAppliedMinor: 1600, deductedMinor: 1600, balanceAfterMinor: 94400, priceBasis: 'PICKUP', fareBand: '0–6 km',
        });
    });

    it('a ride booked under the old ride-count package (no balanceAppliedMinor) deducts the average price per ride', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        const req = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        if (!req.ok) throw new Error(req.reason);
        await rawPrisma().ride.update({ where: { id: req.ride.id }, data: { balanceAppliedMinor: null, fareMinor: 0, priceBasis: null } });
        const driver = await rawPrisma().driver.create({ data: { tenantId, name: 'K', phone: '+233200000009', vehicle: 'V', plate: 'P' } });
        await assignDriver(prisma, { tenantId, rideId: req.ride.id, driverId: driver.id });
        expect(await setRideStatus(prisma, { tenantId, rideId: req.ride.id, status: 'COMPLETED' })).toMatchObject({ ok: true, deducted: true, deductedMinor: 1600, balanceAfterMinor: 94400 });
        expect((await passBalance(prisma, tenantId, pass.id)).ridesTaken).toBe(1);
    });

    it('eight concurrent assigns of the same driver: one change (one customer notice), the rest no-ops', async () => {
        const prisma = await db();
        const c = await customer();
        await activePass(c.id);
        const req = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        if (!req.ok) throw new Error(req.reason);
        const driver = await rawPrisma().driver.create({ data: { tenantId, name: 'Kofi', phone: '+233200000001', vehicle: 'Vitz', plate: 'GR 1' } });
        const { ok, failed } = await race(8, () => assignDriver(prisma, { tenantId, rideId: req.ride.id, driverId: driver.id }));
        expect(failed).toEqual([]);
        expect(ok.filter((r) => r.ok && r.changed)).toHaveLength(1);
        expect(ok.filter((r) => r.ok && !r.changed)).toHaveLength(7);
    });

    it('cancelling never deducts; one open ride at a time; package rides of any distance are allowed', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        const far = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: FAR });
        expect(far.ok && far.ride.fareMinor).toBe(2500);
        if (far.ok) await setRideStatus(prisma, { tenantId, rideId: far.ride.id, status: 'CANCELLED', by: 'customer' });
        const a = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        expect(a.ok).toBe(true);
        expect(await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY })).toMatchObject({ ok: false, reason: 'open_ride' });
        if (!a.ok) return;
        const cancelled = await setRideStatus(prisma, { tenantId, rideId: a.ride.id, status: 'CANCELLED', by: 'customer' });
        expect(cancelled).toMatchObject({ ok: true, changed: true, deducted: false, refundDue: false });
        expect((await passBalance(prisma, tenantId, pass.id)).remainingMinor).toBe(96000);
        expect(await setRideStatus(prisma, { tenantId, rideId: a.ride.id, status: 'COMPLETED' })).toMatchObject({ ok: false, error: 'invalid_state' });
    });

    it('no balance: refused before a ride is created', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        await rawPrisma().ridePassEntry.create({ data: { tenantId, passId: pass.id, type: 'ADJUSTMENT', amountMinor: -96000 } });
        expect(await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY })).toMatchObject({ ok: false, reason: 'no_balance' });
        expect(await rawPrisma().ride.count({ where: { tenantId, customerId: c.id } })).toBe(0);
    });

    it('a shortfall under GHS 2 is waived: booked from the balance alone, recorded on the ride', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        await rawPrisma().ridePassEntry.create({ data: { tenantId, passId: pass.id, type: 'ADJUSTMENT', amountMinor: -(96000 - 1450) } });
        const r = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        expect(r).toMatchObject({ ok: true, settlement: { mode: 'waive', waivedMinor: 150 } });
        if (!r.ok) return;
        expect(await rawPrisma().ride.findUniqueOrThrow({ where: { id: r.ride.id } })).toMatchObject({ fareMinor: 1600, balanceAppliedMinor: 1450, waivedMinor: 150, topupMinor: 0 });
    });

    it('fare_changed when the fare shown is not the fare now', async () => {
        const prisma = await db();
        const c = await customer();
        await activePass(c.id);
        expect(await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedFareMinor: 2500 })).toMatchObject({ ok: false, reason: 'fare_changed', fareMinor: 1600 });
    });

    it('fares run from the reference point when one is set (pickup ignored for the price)', async () => {
        const prisma = await db();
        const c = await customer();
        await activePass(c.id);
        // Reference at the Airport: Library is ~8.6 km away from it, so band 2 even though the pickup is next door.
        expect((await updateRideSettings(prisma, tenantId, { fareRef: { label: 'Plaza', lat: FAR.lat, lng: FAR.lng } })).ok).toBe(true);
        const r = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        expect(r.ok && [r.ride.fareMinor, r.ride.priceBasis, r.ride.fareBand]).toEqual([2500, 'REFERENCE', '6–10 km']);
        expect(r.ok && r.ride.distanceKm < 1).toBe(true); // the trip itself is short
    });
});

describe('package top-up (ride_topup)', () => {
    async function shortCustomer(leftMinor: number) {
        const c = await customer();
        const pass = await activePass(c.id);
        await rawPrisma().ridePassEntry.create({ data: { tenantId, passId: pass.id, type: 'ADJUSTMENT', amountMinor: -(96000 - leftMinor) } });
        return { c, pass };
    }

    it('needs_topup from the balance path; the reserve holds the whole balance and charges the difference; payment confirms; completion deducts the balance share', async () => {
        const prisma = await db();
        const { c, pass } = await shortCustomer(1000);
        expect(await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY })).toMatchObject({ ok: false, reason: 'needs_topup', topupMinor: 600 });
        expect(await reserveTopupRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 500 })).toEqual({ ok: false, reason: 'fare_changed' });
        const r = await reserveTopupRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 600, expectedFareMinor: 1600 });
        if (!r.ok) throw new Error(r.reason);
        expect(r.ride).toMatchObject({ kind: 'PACKAGE', status: 'PENDING_PAYMENT', passId: pass.id, fareMinor: 1600, balanceAppliedMinor: 1000, topupMinor: 600 });
        // Asking again re-uses it; a PAYG booking beside it is refused (a ride in flight).
        const again = await reserveTopupRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 600 });
        expect(again.ok && again.reused && again.ride.id === r.ride.id).toBe(true);
        expect(await reservePaygRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY })).toEqual({ ok: false, reason: 'open_ride' });
        // Unpaid, it is not a ride in the lists.
        expect((await inTenant(() => rideHistory(prisma, tenantId, { page: 1, limit: 20 }, false))).pagination.total).toBe(0);
        const pays = await inTenant(() => paymentList(prisma, tenantId, { page: 1, limit: 20, kind: 'PACKAGE', status: 'PENDING' }, false));
        expect(pays.data).toEqual([expect.objectContaining({ kind: 'PACKAGE', purpose: 'PACKAGE_TOPUP', amount: '6.00', rideRef: r.ride.ref, passId: pass.id })]);

        expect((await confirmTopupOnPayment(prisma, { tenantId, rideId: r.ride.id, reference: 'tp1', amountMinor: 500, currency: 'GHS' })).outcome).toBe('underpaid');
        const base = { prisma, tenantId, entityId: r.ride.id, amountMinor: 600, currency: 'GHS', log: silentLogger };
        expect(await fulfillRideTopup({ ...base, reference: 'tp1' })).toEqual({ status: 'applied' });
        expect(await fulfillRideTopup({ ...base, reference: 'tp1' })).toEqual({ status: 'already_applied' });
        expect((await rawPrisma().ride.findUniqueOrThrow({ where: { id: r.ride.id } })).status).toBe('REQUESTED');

        const driver = await rawPrisma().driver.create({ data: { tenantId, name: 'K', phone: '+233200000008', vehicle: 'V', plate: 'P' } });
        await assignDriver(prisma, { tenantId, rideId: r.ride.id, driverId: driver.id });
        expect(await setRideStatus(prisma, { tenantId, rideId: r.ride.id, status: 'COMPLETED' })).toMatchObject({ deductedMinor: 1000, balanceAfterMinor: 0 });
    });

    it('cancelling a paid top-up ride: refund due naming the GHS amount, nothing deducted', async () => {
        const prisma = await db();
        const { c, pass } = await shortCustomer(1000);
        const r = await reserveTopupRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 600 });
        if (!r.ok) throw new Error(r.reason);
        await confirmTopupOnPayment(prisma, { tenantId, rideId: r.ride.id, reference: 'tp2', amountMinor: 600, currency: 'GHS' });
        const out = await setRideStatus(prisma, { tenantId, rideId: r.ride.id, status: 'CANCELLED', by: 'customer' });
        expect(out).toMatchObject({ ok: true, refundDue: true, refundMinor: 600, deducted: false });
        expect((await passBalance(prisma, tenantId, pass.id)).remainingMinor).toBe(1000);
    });

    it('paid after the hold lapsed: revived when everything still holds, refused loudly when the pass expired', async () => {
        const prisma = await db();
        const { c } = await shortCustomer(1000);
        const r = await reserveTopupRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 600 });
        if (!r.ok) throw new Error(r.reason);
        await sweepRides(prisma, silentLogger, new Date(Date.now() + 31 * 60_000));
        expect((await rawPrisma().ride.findUniqueOrThrow({ where: { id: r.ride.id } })).cancelReason).toBe('payment_timeout');
        expect((await confirmTopupOnPayment(prisma, { tenantId, rideId: r.ride.id, reference: 'tp3', amountMinor: 600, currency: 'GHS' })).outcome).toBe('confirmed');

        const other = await shortCustomer(1000);
        const r2 = await reserveTopupRide(prisma, { tenantId, customerId: other.c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 600 });
        if (!r2.ok) throw new Error(r2.reason);
        await sweepRides(prisma, silentLogger, new Date(Date.now() + 31 * 60_000));
        await rawPrisma().ridePass.update({ where: { id: other.pass.id }, data: { status: 'EXPIRED' } });
        const out = await fulfillRideTopup({ prisma, tenantId, entityId: r2.ride.id, reference: 'tp4', amountMinor: 600, currency: 'GHS', log: silentLogger });
        expect(out).toEqual({ status: 'rejected', reason: 'not_confirmed:pass_inactive' });
        expect(await rawPrisma().ride.findUniqueOrThrow({ where: { id: r2.ride.id } })).toMatchObject({ status: 'CANCELLED', cancelReason: 'paid_pass_inactive', paidAmountMinor: 600 });
        const alert = await rawPrisma().platformAlert.findFirstOrThrow({ where: { tenantId, kind: 'ride_topup.not_applied' } });
        expect(alert.message).toMatch(/GHS 6/);
    });

    it('the sweeper does not expire a pass while a top-up link is live', async () => {
        const prisma = await db();
        const { c, pass } = await shortCustomer(1000);
        await reserveTopupRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, expectedTopupMinor: 600 });
        await rawPrisma().ridePass.update({ where: { id: pass.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
        expect((await sweepRides(prisma, silentLogger, new Date(Date.now() + 60_000))).expiredPasses).toBe(0);
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe('ACTIVE');
    });
});

describe('PAYG capacity', () => {
    it('concurrent PAYG past the daily limit: exactly `limit` seats, then the sweep gives unpaid seats back', async () => {
        const prisma = await db();
        await updateRideSettings(prisma, tenantId, { payg: { dailyLimit: 3 } });
        const riders = await Promise.all(Array.from({ length: 8 }, () => customer()));
        const { ok, failed } = await race(8, (i) => reservePaygRide(prisma, { tenantId, customerId: riders[i].id, pickup: GATE, destination: LIBRARY }));
        expect(failed).toEqual([]);
        expect(ok.filter((r) => r.ok)).toHaveLength(3);
        expect(ok.filter((r) => !r.ok && r.reason === 'full')).toHaveLength(5);
        const s = await getRideSettings(prisma, tenantId);
        const day = paygDayKey(new Date(), s.timezone);
        expect((await rawPrisma().paygDay.findFirstOrThrow({ where: { tenantId, day } })).used).toBe(3);
        expect((await paygStatus(prisma, tenantId)).reason).toBe('full');

        // One pays in time; the other two expire.
        const paid = ok.find((r) => r.ok)!;
        if (!paid.ok) return;
        expect((await confirmPaygOnPayment(prisma, { tenantId, rideId: paid.ride.id, reference: 'payg_1', amountMinor: 2500, currency: 'GHS' })).outcome).toBe('confirmed');
        const swept = await sweepRides(prisma, silentLogger, new Date(Date.now() + 31 * 60_000));
        expect(swept.expiredPayg).toBe(2);
        expect((await rawPrisma().paygDay.findFirstOrThrow({ where: { tenantId, day } })).used).toBe(1);
    });

    it('re-asking for a link re-uses the unpaid ride and its seat; closed PAYG refuses', async () => {
        const prisma = await db();
        const c = await customer();
        const a = await reservePaygRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        const b = await reservePaygRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        expect(a.ok && b.ok && a.ride.id === b.ride.id && b.reused).toBe(true);
        expect((await rawPrisma().paygDay.findFirstOrThrow({ where: { tenantId } })).used).toBe(1);
        await updateRideSettings(prisma, tenantId, { payg: { open: false } });
        expect(await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: LIBRARY })).toEqual({ ok: false, reason: 'closed' });
    });

    it('a payment racing the expiry sweep never leaves a paid ride without its seat', async () => {
        const prisma = await db();
        for (let i = 0; i < 5; i++) {
            const c = await customer();
            const r = await reservePaygRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
            if (!r.ok) throw new Error(r.reason);
            await rawPrisma().ride.update({ where: { id: r.ride.id }, data: { paymentExpiresAt: new Date(Date.now() - 1000) } });
            const [confirmed] = await Promise.all([
                confirmPaygOnPayment(prisma, { tenantId, rideId: r.ride.id, reference: `race_${i}`, amountMinor: 2500, currency: 'GHS' }),
                sweepRides(prisma, silentLogger),
            ]);
            expect(confirmed.outcome).toBe('confirmed');
            expect((await rawPrisma().ride.findUniqueOrThrow({ where: { id: r.ride.id } })).status).toBe('REQUESTED');
        }
        const s = await getRideSettings(prisma, tenantId);
        expect((await rawPrisma().paygDay.findFirstOrThrow({ where: { tenantId, day: paygDayKey(new Date(), s.timezone) } })).used).toBe(5);
    });

    it('an ops cancel reason can never pose as a system code (no re-confirm path for it)', async () => {
        const prisma = await db();
        const r = await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: LIBRARY });
        if (!r.ok) throw new Error(r.reason);
        await setRideStatus(prisma, { tenantId, rideId: r.ride.id, status: 'CANCELLED', reason: 'payment_timeout' });
        expect((await rawPrisma().ride.findUniqueOrThrow({ where: { id: r.ride.id } })).cancelReason).toBe('ops: payment_timeout');
        const paid = await confirmPaygOnPayment(prisma, { tenantId, rideId: r.ride.id, reference: 'after_ops_cancel', amountMinor: 2500, currency: 'GHS' });
        expect(paid).toMatchObject({ outcome: 'refused', reason: 'not_payable' });
    });

    it('PAYG seat squatting: 3 unpaid timed-out rides in 24h block a 4th', async () => {
        const prisma = await db();
        const c = await customer();
        let t = Date.now();
        for (let i = 0; i < 3; i += 1) {
            const r = await reservePaygRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, now: new Date(t) });
            expect(r.ok).toBe(true);
            t += 31 * 60_000;
            await sweepRides(prisma, silentLogger, new Date(t));
        }
        expect(await reservePaygRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY, now: new Date(t) })).toEqual({ ok: false, reason: 'hold_limit' });
    });

    it('fare tiers: 0-6 km GHS 25, 6-10 km GHS 35, over 10 km a flat GHS 50 (none when the over fare is unset)', async () => {
        const prisma = await db();
        const TEMA = { label: 'Tema', lat: 5.67, lng: -0.0166 };
        const near = await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: LIBRARY });
        const mid = await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: FAR });
        const over = await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: TEMA });
        expect(near.ok && near.ride.fareMinor).toBe(2500);
        expect(mid.ok && mid.ride.fareMinor).toBe(3500);
        expect(over.ok && [over.ride.fareMinor, over.ride.fareBand]).toEqual([5000, 'Over 10 km']);
        await updateRideSettings(prisma, tenantId, { payg: { overFare: null } });
        expect(await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: TEMA })).toEqual({ ok: false, reason: 'not_offered' });
    });

    it('settings: an over fare below the last tier is refused and nothing is saved', async () => {
        const prisma = await db();
        expect(await updateRideSettings(prisma, tenantId, { payg: { overFare: 3000 }, driverSms: true })).toMatchObject({ ok: false });
        expect((await getRideSettings(prisma, tenantId))).toMatchObject({ paygOverFareMinor: 5000, driverSms: false });
    });

    it('PAYG fulfiller: confirms once, a paid-after-expiry with no seat left is recorded for refund', async () => {
        const prisma = await db();
        await updateRideSettings(prisma, tenantId, { payg: { dailyLimit: 1 } });
        const a = await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: LIBRARY });
        if (!a.ok) throw new Error(a.reason);
        await sweepRides(prisma, silentLogger, new Date(Date.now() + 31 * 60_000)); // a expires, seat back
        const b = await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: LIBRARY });
        if (!b.ok) throw new Error(b.reason);
        const base = { prisma, tenantId, amountMinor: 2500, currency: 'GHS', log: silentLogger };
        expect(await fulfillRidePayg({ ...base, entityId: b.ride.id, reference: 'pb', transactionId: '4099260516', channel: 'mobile_money' })).toEqual({ status: 'applied' });
        const paid = (await inTenant(() => paymentList(prisma, tenantId, { page: 1, limit: 20, kind: 'PAYG', status: 'SUCCEEDED' }, false))).data[0];
        expect(paid).toMatchObject({ providerReference: '4099260516', channel: 'mobile_money' });
        expect(await fulfillRidePayg({ ...base, entityId: b.ride.id, reference: 'pb' })).toEqual({ status: 'already_applied' });
        expect(await fulfillRidePayg({ ...base, entityId: a.ride.id, reference: 'pa' })).toEqual({ status: 'rejected', reason: 'not_confirmed:capacity_full' });
        expect((await rawPrisma().ride.findUniqueOrThrow({ where: { id: a.ride.id } })).status).toBe('CANCELLED');
        expect(await rawPrisma().platformAlert.count({ where: { tenantId, kind: 'ride_payg.not_applied' } })).toBe(1);
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'ride.requested' } })).toBe(1);
    });
});

describe('sweeper: expiry and reminders', () => {
    it('expires a package (unused credit leaves the balance), reminds once each', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        await rawPrisma().ridePassEntry.create({ data: { tenantId, passId: pass.id, type: 'ADJUSTMENT', amountMinor: -(96000 - 8000) } }); // GHS 80 left

        const day51 = new Date(pass.activatedAt!.getTime() + 51 * 86400_000);
        const first = await sweepRides(prisma, silentLogger, day51);
        expect(first).toMatchObject({ expiryReminders: 1, lowBalanceReminders: 1, expiredPasses: 0 });
        const again = await sweepRides(prisma, silentLogger, day51);
        expect(again).toMatchObject({ expiryReminders: 0, lowBalanceReminders: 0 });

        const day61 = new Date(pass.activatedAt!.getTime() + 61 * 86400_000);
        expect((await sweepRides(prisma, silentLogger, day61)).expiredPasses).toBe(1);
        expect((await rawPrisma().ridePass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe('EXPIRED');
        expect(await rawPrisma().ridePassEntry.findMany({ where: { passId: pass.id, type: 'EXPIRY' }, select: { amountMinor: true, delta: true } })).toEqual([{ amountMinor: -8000, delta: null }]);
        expect((await passBalance(prisma, tenantId, pass.id)).remainingMinor).toBe(0);
        expect((await customerBalance(prisma, tenantId, c.id, day61)).active).toBe(false);
    });

    it('a package with a ride in progress expires only after that ride ends', async () => {
        const prisma = await db();
        const c = await customer();
        const pass = await activePass(c.id);
        await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        const day61 = new Date(pass.activatedAt!.getTime() + 61 * 86400_000);
        expect((await sweepRides(prisma, silentLogger, day61)).expiredPasses).toBe(0);
    });
});

describe('console queries on the real schema, with the tenant guard live', () => {
    it('overview, live, history, customers, detail, passes, payments', async () => {
        const prisma = await db();
        const c = await customer('Ama Mensah');
        await rawPrisma().customer.update({ where: { id: c.id }, data: { attributes: { studentId: '20211234', university: 'Central University' } } });
        const pass = await activePass(c.id);
        const req = await requestPackageRide(prisma, { tenantId, customerId: c.id, pickup: GATE, destination: LIBRARY });
        if (!req.ok) throw new Error(req.reason);
        const driver = await rawPrisma().driver.create({ data: { tenantId, name: 'Kofi', phone: '+233200000001', vehicle: 'Vitz', plate: 'GR 1' } });
        await assignDriver(prisma, { tenantId, rideId: req.ride.id, driverId: driver.id });
        await setRideStatus(prisma, { tenantId, rideId: req.ride.id, status: 'COMPLETED' });
        await reservePaygRide(prisma, { tenantId, customerId: (await customer()).id, pickup: GATE, destination: LIBRARY });

        const o = await inTenant(() => overview(prisma, tenantId));
        expect(o).toMatchObject({
            packages: { sold: 1, activated: 1, cap: 50, slotsLeft: 49, held: 0 },
            credit: { used: '16.00', remaining: '944.00' },
            rides: { completed: 1 },
            live: { REQUESTED: 0, ASSIGNED: 0, EN_ROUTE: 0 },
            payg: { open: true, dailyLimit: 10, used: 1, available: 9 },
            payments: { SUCCEEDED: 1, PENDING: 1, FAILED: 0 },
            ridesToday: { PACKAGE: 1, PAYG: 0 },
        });
        expect((await inTenant(() => liveRides(prisma, tenantId, undefined, false))).data).toHaveLength(0);
        const hist = await inTenant(() => rideHistory(prisma, tenantId, { page: 1, limit: 20 }, true));
        expect(hist.data).toHaveLength(1);
        expect(hist.data[0]).toMatchObject({ ref: req.ride.ref, status: 'COMPLETED', fare: '16.00', deducted: '16.00', balanceAfter: '944.00', fareBand: '0–6 km', driver: { name: 'Kofi', plate: 'GR 1' } });
        expect(hist.data[0].customer.phone).not.toBe(c.phone); // masked

        const list = await inTenant(() => customerList(prisma, tenantId, { page: 1, limit: 20, search: '2021' }, true));
        expect(list.data).toEqual([expect.objectContaining({ id: c.id, studentId: '20211234', university: 'Central University', balance: '944.00', package: { id: pass.id, name: 'Pioneer 50', status: 'ACTIVE' } })]);
        const detail = await inTenant(() => customerDetail(prisma, tenantId, c.id, false));
        expect(detail?.balanceLog.map((e) => [e.reason, e.amount, e.balanceAfter, e.rideRef])).toEqual([['RIDE', '-16.00', '944.00', req.ride.ref], ['ACTIVATION', '960.00', '960.00', null]]);
        expect(detail?.passes[0]).toMatchObject({ status: 'ACTIVE', credit: '960.00', used: '16.00', remaining: '944.00', ridesTaken: 1, price: '960.00' });

        expect((await inTenant(() => passList(prisma, tenantId, { page: 1, limit: 20, status: 'ACTIVE' }, false))).pagination.total).toBe(1);
        expect((await inTenant(() => passList(prisma, tenantId, { page: 1, limit: 20, status: 'EXHAUSTED' }, false))).pagination.total).toBe(0);
        const pays = await inTenant(() => paymentList(prisma, tenantId, { page: 1, limit: 20 }, false));
        expect(pays.data.map((p) => [p.kind, p.purpose, p.status, p.amount])).toEqual([['PAYG', 'PAYG_RIDE', 'PENDING', '25.00'], ['PACKAGE', 'PACKAGE_PURCHASE', 'SUCCEEDED', '960.00']]);
        expect((await inTenant(() => paymentList(prisma, tenantId, { page: 1, limit: 20, kind: 'PAYG', status: 'SUCCEEDED' }, false))).pagination.total).toBe(0);
    });
});
});
