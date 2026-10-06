/**
 * Ride lifecycle.
 *
 *   PACKAGE: REQUESTED -> ASSIGNED -> EN_ROUTE -> COMPLETED      (or CANCELLED before COMPLETED)
 *   PAYG:    PENDING_PAYMENT -> REQUESTED -> ... same            (PENDING_PAYMENT expires -> CANCELLED)
 *
 * DEDUCTION. A package ride takes one ride off the balance ONLY when it is
 * marked COMPLETED, exactly once: the status claim is a guarded updateMany
 * (only one caller sees count 1) and the -1 balance entry is written in the
 * same transaction with UNIQUE(rideId), so even a bug that claimed twice could
 * not deduct twice. Cancelling never deducts.
 *
 * One open ride per customer at a time (keeps the balance from being
 * over-committed by several requests in flight). Checked under a per-customer
 * advisory lock.
 */
import { randomInt } from 'node:crypto';
import type { Prisma, Ride, RideStatus } from '@prisma/client';
import { isUniqueViolation, type RidesClient, type RidesDb } from './db.js';
import { getRideSettings } from './settings.js';
import { roadDistanceKm, paygFareMinor, packageEligible, isValidCoordinate } from './geo.js';
import { findActivePass, passBalance, AMOUNT_TOLERANCE_MINOR, HOLD_LIFETIME_FACTOR, MAX_UNPAID_HOLDS_PER_DAY } from './passes.js';
import { paygDayKey, releasePaygSlot, reservePaygSlot } from './capacity.js';

export const OPEN_STATUSES: RideStatus[] = ['REQUESTED', 'ASSIGNED', 'EN_ROUTE'];
/**
 * Rides that really happened or were really booked. An unpaid PAYG row (link
 * sent, or expired unpaid) is a payment attempt, not a ride: it shows under
 * payments, never in ride lists or counts.
 */
export const BOOKED_RIDE: Prisma.RideWhereInput = { NOT: { kind: 'PAYG', paidAt: null } };
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REF_ATTEMPTS = 3;

export const rideInclude = {
    customer: { select: { id: true, name: true, phone: true } },
    driver: { select: { id: true, name: true, vehicle: true, plate: true, phone: true } },
} as const satisfies Prisma.RideInclude;
export type RideWithRelations = Prisma.RideGetPayload<{ include: typeof rideInclude }>;

export interface Place {
    label: string;
    lat: number;
    lng: number;
    /** A saved RideDestination, when the customer picked one. */
    id?: string | null;
}

export function newRideRef(): string {
    let s = '';
    for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
    return `TR-${s}`;
}

/** A ref collision (1 in ~10^9) aborts the transaction; run the whole thing again with a new ref. */
async function withRefRetry<T>(fn: (ref: string) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await fn(newRideRef());
        } catch (err) {
            const target = String((err as { meta?: { target?: unknown } }).meta?.target ?? '');
            if (attempt >= REF_ATTEMPTS || !isUniqueViolation(err) || !target.includes('ref')) throw err;
        }
    }
}

/** Serialises everything that books for, or settles, one customer's rides. */
export async function lockCustomer(tx: RidesDb, customerId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ride_customer:' + customerId}, 0))`;
}

function cleanLabel(label: string): string {
    // eslint-disable-next-line no-control-regex
    return label.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200) || 'Shared location';
}

function placeOk(p: Place): boolean {
    return isValidCoordinate(p.lat, p.lng);
}

// ---------------------------------------------------------------- quotes

export type PackageQuote =
    | { ok: true; distanceKm: number; remaining: number; passId: string }
    | { ok: false; reason: 'no_package' | 'no_rides_left' | 'too_far' | 'bad_location'; distanceKm?: number; maxKm?: number; remaining?: number };

export async function quotePackageRide(db: RidesDb, args: { tenantId: string; customerId: string; pickup: Place; destination: Place; now?: Date }): Promise<PackageQuote> {
    if (!placeOk(args.pickup) || !placeOk(args.destination)) return { ok: false, reason: 'bad_location' };
    const s = await getRideSettings(db, args.tenantId);
    const pass = await findActivePass(db, args.tenantId, args.customerId, args.now);
    if (!pass) return { ok: false, reason: 'no_package' };
    const { remaining } = await passBalance(db, args.tenantId, pass.id);
    const distanceKm = roadDistanceKm(args.pickup, args.destination, s.roadFactor);
    if (remaining <= 0) return { ok: false, reason: 'no_rides_left', remaining, distanceKm };
    if (!packageEligible(distanceKm, pass.maxKm)) return { ok: false, reason: 'too_far', distanceKm, maxKm: pass.maxKm, remaining };
    return { ok: true, distanceKm, remaining, passId: pass.id };
}

export type PaygQuote =
    | { ok: true; distanceKm: number; fareMinor: number; currency: string }
    | { ok: false; reason: 'closed' | 'not_offered' | 'bad_location'; distanceKm?: number; maxKm?: number };

export async function quotePaygRide(db: RidesDb, args: { tenantId: string; pickup: Place; destination: Place }): Promise<PaygQuote> {
    if (!placeOk(args.pickup) || !placeOk(args.destination)) return { ok: false, reason: 'bad_location' };
    const s = await getRideSettings(db, args.tenantId);
    if (!s.paygOpen) return { ok: false, reason: 'closed' };
    const distanceKm = roadDistanceKm(args.pickup, args.destination, s.roadFactor);
    const fareMinor = paygFareMinor(distanceKm, s.paygFares);
    if (fareMinor === null) return { ok: false, reason: 'not_offered', distanceKm, maxKm: s.paygFares[s.paygFares.length - 1]?.upToKm };
    return { ok: true, distanceKm, fareMinor, currency: s.currency };
}

export interface PaygStatus {
    open: boolean;
    day: string;
    used: number;
    limit: number;
    available: number;
    /** closed = switched off; full = today's limit reached. */
    reason: 'open' | 'closed' | 'full';
    fromFareMinor: number;
    currency: string;
}

export async function paygStatus(db: RidesDb, tenantId: string, now = new Date()): Promise<PaygStatus> {
    const s = await getRideSettings(db, tenantId);
    const day = paygDayKey(now, s.timezone);
    const row = await db.paygDay.findFirst({ where: { tenantId, day }, select: { used: true } });
    const used = row?.used ?? 0;
    const available = Math.max(0, s.paygDailyLimit - used);
    const reason = !s.paygOpen ? 'closed' : available <= 0 ? 'full' : 'open';
    return {
        open: reason === 'open', day, used, limit: s.paygDailyLimit, available, reason,
        fromFareMinor: s.paygFares[0]?.fareMinor ?? 0, currency: s.currency,
    };
}

// ---------------------------------------------------------------- package rides

export type RequestRideResult =
    | { ok: true; ride: RideWithRelations; remaining: number }
    | { ok: false; reason: 'no_package' | 'no_rides_left' | 'too_far' | 'bad_location' | 'open_ride'; distanceKm?: number; maxKm?: number };

export async function requestPackageRide(
    prisma: RidesClient,
    args: { tenantId: string; customerId: string; conversationId?: string | null; pickup: Place; destination: Place; source?: 'WHATSAPP' | 'APP' | 'CONSOLE'; now?: Date },
): Promise<RequestRideResult> {
    const now = args.now ?? new Date();
    return withRefRetry((ref) => prisma.$transaction(async (tx): Promise<RequestRideResult> => {
        await lockCustomer(tx, args.customerId);
        const quote = await quotePackageRide(tx, { ...args, now });
        if (!quote.ok) return { ok: false, reason: quote.reason, distanceKm: quote.distanceKm, maxKm: quote.maxKm };
        const open = await tx.ride.count({
            where: {
                tenantId: args.tenantId, customerId: args.customerId,
                OR: [{ status: { in: OPEN_STATUSES } }, { status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } }],
            },
        });
        if (open > 0) return { ok: false, reason: 'open_ride' };
        const s = await getRideSettings(tx, args.tenantId);
        const ride = await tx.ride.create({
            data: {
                tenantId: args.tenantId, ref, kind: 'PACKAGE', status: 'REQUESTED',
                customerId: args.customerId, conversationId: args.conversationId ?? null, passId: quote.passId,
                pickupLabel: cleanLabel(args.pickup.label), pickupLat: args.pickup.lat, pickupLng: args.pickup.lng,
                destinationLabel: cleanLabel(args.destination.label), destinationLat: args.destination.lat, destinationLng: args.destination.lng,
                destinationId: args.destination.id ?? null,
                distanceKm: quote.distanceKm, fareMinor: 0, currency: s.currency,
                source: args.source ?? 'WHATSAPP', requestedAt: now,
            },
            include: rideInclude,
        });
        return { ok: true, ride, remaining: quote.remaining };
    }));
}

// ---------------------------------------------------------------- PAYG

export type ReservePaygResult =
    | { ok: true; ride: Ride; reused: boolean }
    | { ok: false; reason: 'closed' | 'full' | 'not_offered' | 'bad_location' | 'open_ride' | 'fare_changed' | 'hold_limit' };

/**
 * Reserve today's PAYG capacity and create the PENDING_PAYMENT ride, in one
 * transaction, when the payment link is created. The customer's own unpaid
 * ride is re-used (keeping its slot), so asking for a new link never takes a
 * second slot. Unpaid by paymentExpiresAt: the sweeper cancels it and gives
 * the slot back.
 */
export async function reservePaygRide(
    prisma: RidesClient,
    args: { tenantId: string; customerId: string; conversationId?: string | null; pickup: Place; destination: Place; expectedFareMinor?: number; source?: 'WHATSAPP' | 'APP' | 'CONSOLE'; now?: Date },
): Promise<ReservePaygResult> {
    const now = args.now ?? new Date();
    return withRefRetry((ref) => prisma.$transaction(async (tx): Promise<ReservePaygResult> => {
        await lockCustomer(tx, args.customerId);
        const quote = await quotePaygRide(tx, args);
        if (!quote.ok) return { ok: false, reason: quote.reason };
        if (args.expectedFareMinor !== undefined && args.expectedFareMinor !== quote.fareMinor) return { ok: false, reason: 'fare_changed' };
        const open = await tx.ride.count({ where: { tenantId: args.tenantId, customerId: args.customerId, status: { in: OPEN_STATUSES } } });
        if (open > 0) return { ok: false, reason: 'open_ride' };

        const s = await getRideSettings(tx, args.tenantId);
        const paymentExpiresAt = new Date(now.getTime() + s.holdMinutes * 60_000);
        const details = {
            conversationId: args.conversationId ?? null,
            pickupLabel: cleanLabel(args.pickup.label), pickupLat: args.pickup.lat, pickupLng: args.pickup.lng,
            destinationLabel: cleanLabel(args.destination.label), destinationLat: args.destination.lat, destinationLng: args.destination.lng,
            destinationId: args.destination.id ?? null,
            distanceKm: quote.distanceKm, fareMinor: quote.fareMinor, currency: quote.currency, paymentExpiresAt,
        };

        const pending = await tx.ride.findFirst({
            where: { tenantId: args.tenantId, customerId: args.customerId, status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } },
            orderBy: { createdAt: 'desc' },
        });
        if (pending) {
            // Asking again re-uses the seat, but never keeps it past its lifetime cap (anti-squatting).
            const lifetimeEnd = pending.requestedAt.getTime() + HOLD_LIFETIME_FACTOR * s.holdMinutes * 60_000;
            const keepUntil = new Date(Math.max(pending.paymentExpiresAt!.getTime(), Math.min(paymentExpiresAt.getTime(), lifetimeEnd)));
            const ride = await tx.ride.update({ where: { id: pending.id, tenantId: args.tenantId }, data: { ...details, paymentExpiresAt: keepUntil } });
            return { ok: true, ride, reused: true };
        }

        const timedOutToday = await tx.ride.count({
            where: {
                tenantId: args.tenantId, customerId: args.customerId, kind: 'PAYG', paidAt: null,
                status: 'CANCELLED', cancelReason: 'payment_timeout',
                requestedAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) },
            },
        });
        if (timedOutToday >= MAX_UNPAID_HOLDS_PER_DAY) return { ok: false, reason: 'hold_limit' };

        const day = paygDayKey(now, s.timezone);
        if (!(await reservePaygSlot(tx, args.tenantId, day, s.paygDailyLimit))) return { ok: false, reason: 'full' };
        const ride = await tx.ride.create({
            data: {
                tenantId: args.tenantId, ref, kind: 'PAYG', status: 'PENDING_PAYMENT', customerId: args.customerId,
                ...details, paygDay: day, source: args.source ?? 'WHATSAPP', requestedAt: now,
            },
        });
        return { ok: true, ride, reused: false };
    }));
}

export async function recordRideLink(db: RidesDb, tenantId: string, rideId: string, reference: string): Promise<void> {
    await db.ride.updateMany({ where: { id: rideId, tenantId, paidAt: null }, data: { paymentReference: reference } });
}

export type PaygPaymentOutcome =
    | { outcome: 'confirmed'; ride: Ride }
    | { outcome: 'already_confirmed'; ride: Ride }
    | { outcome: 'already_refused'; ride: Ride; reason: string }
    | { outcome: 'refused'; ride: Ride; reason: 'capacity_full' | 'paid_twice' | 'not_payable' }
    | { outcome: 'underpaid'; ride: Ride }
    | { outcome: 'not_found' };

/**
 * Confirm a PAYG ride on a VERIFIED payment. Idempotent per reference. A
 * payment for a ride whose unpaid hold already expired re-takes today's
 * capacity if there is any; otherwise it is recorded (refund due), not confirmed.
 */
export async function confirmPaygOnPayment(
    prisma: RidesClient,
    args: { tenantId: string; rideId: string; reference: string; amountMinor: number; currency: string; transactionId?: string; channel?: string; now?: Date },
): Promise<PaygPaymentOutcome> {
    const now = args.now ?? new Date();
    return prisma.$transaction(async (tx): Promise<PaygPaymentOutcome> => {
        const found = await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId, kind: 'PAYG' } });
        if (!found) return { outcome: 'not_found' };
        await lockCustomer(tx, found.customerId);
        // Row lock: the sweeper's expiry and an ops cancel (guarded updateMany claims) wait for us, and we read the
        // row as they left it. Without it a cancel committed between our read and our write would be overwritten
        // by REQUESTED after its seat was already given back (the day oversold by one).
        await tx.$queryRaw`SELECT id FROM "Ride" WHERE id = ${args.rideId} AND "tenantId" = ${args.tenantId} FOR UPDATE`;
        const ride = (await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId } }))!;

        if (ride.paidAt && ride.paymentReference === args.reference) {
            return ride.status === 'CANCELLED' && ride.cancelReason?.startsWith('paid_')
                ? { outcome: 'already_refused', ride, reason: ride.cancelReason }
                : { outcome: 'already_confirmed', ride };
        }
        if (ride.paidAt) return { outcome: 'refused', ride, reason: 'paid_twice' };
        if (args.currency.toUpperCase() !== ride.currency.toUpperCase() || args.amountMinor < ride.fareMinor - AMOUNT_TOLERANCE_MINOR) {
            return { outcome: 'underpaid', ride };
        }
        const paid = { paymentReference: args.reference, paidAt: now, paidAmountMinor: args.amountMinor, providerTransactionId: args.transactionId ?? null, paymentChannel: args.channel ?? null, paymentExpiresAt: null };

        if (ride.status === 'PENDING_PAYMENT') {
            const updated = await tx.ride.update({ where: { id: ride.id, tenantId: args.tenantId }, data: { ...paid, status: 'REQUESTED', requestedAt: now } });
            return { outcome: 'confirmed', ride: updated };
        }
        if (ride.status === 'CANCELLED' && ride.cancelReason === 'payment_timeout') {
            const s = await getRideSettings(tx, args.tenantId);
            const day = paygDayKey(now, s.timezone);
            if (await reservePaygSlot(tx, args.tenantId, day, s.paygDailyLimit)) {
                const updated = await tx.ride.update({
                    where: { id: ride.id, tenantId: args.tenantId },
                    data: { ...paid, status: 'REQUESTED', requestedAt: now, paygDay: day, cancelledAt: null, cancelReason: null },
                });
                return { outcome: 'confirmed', ride: updated };
            }
            const updated = await tx.ride.update({ where: { id: ride.id, tenantId: args.tenantId }, data: { ...paid, cancelReason: 'paid_after_expiry_capacity_full' } });
            return { outcome: 'refused', ride: updated, reason: 'capacity_full' };
        }
        const updated = await tx.ride.update({
            where: { id: ride.id, tenantId: args.tenantId },
            data: { ...paid, ...(ride.status === 'CANCELLED' ? { cancelReason: 'paid_after_cancel' } : {}) },
        });
        return { outcome: 'refused', ride: updated, reason: 'not_payable' };
    });
}

// ---------------------------------------------------------------- dispatch

export type DispatchError = 'not_found' | 'invalid_state' | 'driver_not_found';
export type DispatchResult<T = object> = ({ ok: true; ride: RideWithRelations } & T) | { ok: false; error: DispatchError; status?: RideStatus };

export async function assignDriver(
    prisma: RidesClient,
    args: { tenantId: string; rideId: string; driverId: string; now?: Date },
): Promise<DispatchResult<{ changed: boolean }>> {
    const now = args.now ?? new Date();
    const driver = await prisma.driver.findFirst({ where: { id: args.driverId, tenantId: args.tenantId, active: true } });
    if (!driver) return { ok: false, error: 'driver_not_found' };
    const current = await prisma.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, include: rideInclude });
    if (!current) return { ok: false, error: 'not_found' };
    if (current.status === 'ASSIGNED' && current.driverId === driver.id) return { ok: true, ride: current, changed: false };
    const claimed = await prisma.ride.updateMany({
        // Re-assigning to the SAME driver is not a change (no second notice to the customer).
        where: { id: args.rideId, tenantId: args.tenantId, OR: [{ status: 'REQUESTED' }, { status: 'ASSIGNED', driverId: { not: driver.id } }] },
        data: { status: 'ASSIGNED', driverId: driver.id, assignedAt: now },
    });
    const ride = await prisma.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, include: rideInclude });
    if (!ride) return { ok: false, error: 'not_found' };
    if (claimed.count === 0) {
        if (ride.status === 'ASSIGNED' && ride.driverId === driver.id) return { ok: true, ride, changed: false };
        return { ok: false, error: 'invalid_state', status: ride.status };
    }
    return { ok: true, ride, changed: true };
}

export type StatusChange = 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED';

const FROM: Record<StatusChange, RideStatus[]> = {
    EN_ROUTE: ['ASSIGNED'],
    COMPLETED: ['ASSIGNED', 'EN_ROUTE'],
    CANCELLED: ['PENDING_PAYMENT', 'REQUESTED', 'ASSIGNED', 'EN_ROUTE'],
};

export interface StatusOutcome {
    changed: boolean;
    /** COMPLETED package ride: the -1 entry was written by THIS call. */
    deducted: boolean;
    /** Package balance after the change (package rides only). */
    remaining: number | null;
    /** A paid PAYG ride was cancelled: the tenant owes a refund. */
    refundDue: boolean;
    previousStatus: RideStatus;
}

/**
 * Move a ride to EN_ROUTE / COMPLETED / CANCELLED. Repeating the same change
 * is a no-op success (changed: false), so a double click on COMPLETED is safe
 * and deducts once. Any other transition is refused (invalid_state).
 */
/**
 * Who cancels decides the stored reason: `system` codes are kept verbatim (the
 * payment paths branch on them, e.g. payment_timeout); ops free text is stored
 * as "ops: ..." so typed text can never look like a system code.
 */
function cancelReasonFor(by: 'ops' | 'customer' | 'system', reason: string | null | undefined): string {
    if (by === 'system') return (reason ?? 'system').slice(0, 100);
    if (by === 'customer') return 'customer';
    const text = (reason ?? '').trim();
    return text ? `ops: ${text}`.slice(0, 300) : 'ops';
}

export async function setRideStatus(
    prisma: RidesClient,
    args: { tenantId: string; rideId: string; status: StatusChange; reason?: string | null; by?: 'ops' | 'customer' | 'system'; now?: Date },
): Promise<DispatchResult<StatusOutcome>> {
    const now = args.now ?? new Date();
    const by = args.by ?? 'ops';
    // A customer can only cancel, and only before a driver is assigned.
    if (by === 'customer' && args.status !== 'CANCELLED') return { ok: false, error: 'invalid_state' };
    const result = await prisma.$transaction(async (tx) => {
        const before = await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId } });
        if (!before) return { ok: false as const, error: 'not_found' as const };
        const from = by === 'customer' ? (['REQUESTED'] as RideStatus[]) : FROM[args.status];
        const data: Prisma.RideUncheckedUpdateManyInput =
            args.status === 'EN_ROUTE' ? { status: 'EN_ROUTE', enRouteAt: now }
                : args.status === 'COMPLETED' ? { status: 'COMPLETED', completedAt: now }
                    : { status: 'CANCELLED', cancelledAt: now, cancelReason: cancelReasonFor(by, args.reason) };
        const claimed = await tx.ride.updateMany({ where: { id: args.rideId, tenantId: args.tenantId, status: { in: from } }, data });
        if (claimed.count === 0) {
            // `before` may be stale: a concurrent caller can have committed the change while we waited on the row lock.
            const current = (await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, select: { status: true } }))?.status ?? before.status;
            if (current === args.status) {
                return { ok: true as const, changed: false, deducted: false, refundDue: false, previousStatus: current, passId: before.passId };
            }
            return { ok: false as const, error: 'invalid_state' as const, status: current };
        }

        let deducted = false;
        if (args.status === 'COMPLETED' && before.kind === 'PACKAGE' && before.passId) {
            try {
                await tx.ridePassEntry.create({ data: { tenantId: args.tenantId, passId: before.passId, type: 'RIDE', delta: -1, rideId: before.id } });
                deducted = true;
            } catch (err) {
                // UNIQUE(rideId): already deducted. Cannot happen behind the claim above; never deduct twice regardless.
                if (!isUniqueViolation(err)) throw err;
                throw new Error('ride_already_deducted');
            }
        }
        if (args.status === 'CANCELLED' && before.kind === 'PAYG' && before.paygDay) {
            await releasePaygSlot(tx, args.tenantId, before.paygDay);
        }
        const refundDue = args.status === 'CANCELLED' && before.kind === 'PAYG' && !!before.paidAt;
        return { ok: true as const, changed: true, deducted, refundDue, previousStatus: before.status, passId: before.passId };
    });
    if (!result.ok) return result;

    const ride = await prisma.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, include: rideInclude });
    if (!ride) return { ok: false, error: 'not_found' };
    const remaining = ride.kind === 'PACKAGE' && result.passId ? (await passBalance(prisma, args.tenantId, result.passId)).remaining : null;
    return {
        ok: true, ride, changed: result.changed, deducted: result.deducted, remaining, refundDue: result.refundDue,
        previousStatus: result.previousStatus,
    };
}

/** The customer's open ride (REQUESTED / ASSIGNED / EN_ROUTE), if any. */
export async function findOpenRide(db: RidesDb, tenantId: string, customerId: string): Promise<RideWithRelations | null> {
    return db.ride.findFirst({
        where: { tenantId, customerId, status: { in: OPEN_STATUSES } },
        orderBy: { createdAt: 'desc' },
        include: rideInclude,
    });
}
