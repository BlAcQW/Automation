/**
 * Ride lifecycle.
 *
 *   PACKAGE: REQUESTED -> ASSIGNED -> EN_ROUTE -> COMPLETED      (or CANCELLED before COMPLETED)
 *   PACKAGE with a top-up: PENDING_PAYMENT -> REQUESTED -> ...   (PENDING_PAYMENT expires -> CANCELLED)
 *   PAYG:    PENDING_PAYMENT -> REQUESTED -> ... same            (PENDING_PAYMENT expires -> CANCELLED)
 *
 * FARES. Every ride is priced by distance band (pricing.ts): from the fare
 * reference point when the tenant set one, else from the pickup. The band fare
 * is stored on the ride for both kinds (fareMinor).
 *
 * PACKAGE = GHS CREDIT. Booking reserves the credit the ride will use
 * (balanceAppliedMinor: the fare, or the whole remaining balance when a top-up
 * or a waiver covers the rest). Nothing leaves the balance until the ride is
 * COMPLETED, exactly once: the status claim is a guarded updateMany (only one
 * caller sees count 1) and the RIDE entry (-balanceAppliedMinor) is written in
 * the same transaction with UNIQUE(rideId), so even a bug that claimed twice
 * could not deduct twice. Cancelling never deducts. Rides booked before the
 * credit change (no balanceAppliedMinor) deduct the old average price per ride.
 *
 * One open ride per customer at a time (keeps the balance from being
 * over-committed by several requests in flight), and a top-up whose link is
 * still live counts as one. Checked under a per-customer advisory lock, which
 * completion takes too.
 */
import { randomInt } from 'node:crypto';
import type { Prisma, Ride, RidePass, RideStatus } from '@prisma/client';
import { isUniqueViolation, type RidesClient, type RidesDb } from './db.js';
import { getRideSettings, packageSchedule, paygSchedule, type RideSettingsValues } from './settings.js';
import { roadDistanceKm, isValidCoordinate } from './geo.js';
import { priceTrip, settleWithBalance, type PriceBasis, type Settlement } from './pricing.js';
import {
    availableMinor, findActivePass, legacyRideFareMinor, passBalance,
    AMOUNT_TOLERANCE_MINOR, HOLD_LIFETIME_FACTOR, MAX_UNPAID_HOLDS_PER_DAY,
} from './passes.js';
import { paygDayKey, releasePaygSlot, reservePaygSlot } from './capacity.js';
import { money } from './texts.js';
import { raiseAlert } from '../alerts.js';

export const OPEN_STATUSES: RideStatus[] = ['REQUESTED', 'ASSIGNED', 'EN_ROUTE'];
/**
 * Rides that really happened or were really booked. An unpaid PAYG row, or an
 * unpaid package top-up (link sent, or expired unpaid), is a payment attempt,
 * not a ride: it shows under payments, never in ride lists or counts.
 */
export const BOOKED_RIDE: Prisma.RideWhereInput = {
    // `not: null` matters: a NULL topupMinor (package rides from before the change) would make the NOT unknown and hide the row.
    NOT: [{ kind: 'PAYG', paidAt: null }, { kind: 'PACKAGE', paidAt: null, topupMinor: { not: null, gt: 0 } }],
};
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

function placeOk(p: Place | null | undefined): p is Place {
    return !!p && isValidCoordinate(p.lat, p.lng);
}

/** The customer's booking in flight: an open ride, or any ride whose payment link is still live. */
function inFlight(tenantId: string, customerId: string, now: Date, excludeRideId?: string): Prisma.RideWhereInput {
    return {
        tenantId, customerId,
        ...(excludeRideId ? { id: { not: excludeRideId } } : {}),
        OR: [{ status: { in: OPEN_STATUSES } }, { status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } }],
    };
}

/** The ride columns that record how the trip was priced and placed. */
function tripColumns(pickup: Place, destination: Place, roadFactor: number, price: { distanceKm: number; basis: PriceBasis; band: string; fareMinor: number }) {
    return {
        pickupLabel: cleanLabel(pickup.label), pickupLat: pickup.lat, pickupLng: pickup.lng,
        destinationLabel: cleanLabel(destination.label), destinationLat: destination.lat, destinationLng: destination.lng,
        destinationId: destination.id ?? null,
        distanceKm: roadDistanceKm(pickup, destination, roadFactor),
        priceDistanceKm: price.distanceKm, priceBasis: price.basis, fareBand: price.band, fareMinor: price.fareMinor,
    };
}

// ---------------------------------------------------------------- quotes

export interface FareQuote {
    /** The distance the fare is priced on (reference point or pickup -> destination). */
    priceDistanceKm: number;
    basis: PriceBasis;
    band: string;
    fareMinor: number;
}

export type PackageQuote =
    | ({ ok: true; passId: string; availableMinor: number; settlement: Exclude<Settlement, { mode: 'no_balance' }> } & FareQuote)
    | {
        ok: false;
        reason: 'no_package' | 'no_balance' | 'not_offered' | 'bad_location' | 'needs_pickup';
        priceDistanceKm?: number; maxKm?: number; availableMinor?: number; fareMinor?: number;
    };

/**
 * Price a package ride and say how it would be paid. The pickup is optional
 * when the tenant has a fare reference point (the fare does not depend on it).
 * `excludeRideId`: a pending top-up ride being re-quoted does not count against
 * its own balance.
 */
export async function quotePackageRide(
    db: RidesDb,
    args: { tenantId: string; customerId: string; pickup?: Place | null; destination: Place; now?: Date; excludeRideId?: string; settings?: RideSettingsValues },
): Promise<PackageQuote> {
    const now = args.now ?? new Date();
    if (!placeOk(args.destination) || (args.pickup && !placeOk(args.pickup))) return { ok: false, reason: 'bad_location' };
    const s = args.settings ?? (await getRideSettings(db, args.tenantId));
    const pass = await findActivePass(db, args.tenantId, args.customerId, now);
    if (!pass) return { ok: false, reason: 'no_package' };
    const price = priceTrip({ fareRef: s.fareRef, pickup: args.pickup, destination: args.destination, roadFactor: s.roadFactor, schedule: packageSchedule(s) });
    if (!price.ok) {
        return price.reason === 'not_offered'
            ? { ok: false, reason: 'not_offered', priceDistanceKm: price.distanceKm, maxKm: price.maxKm }
            : { ok: false, reason: price.reason };
    }
    const available = await availableMinor(db, pass, now, args.excludeRideId);
    const settlement = settleWithBalance(price.fareMinor, available);
    if (settlement.mode === 'no_balance') {
        return { ok: false, reason: 'no_balance', availableMinor: Math.max(0, available), fareMinor: price.fareMinor, priceDistanceKm: price.distanceKm };
    }
    return {
        ok: true, passId: pass.id, availableMinor: available, settlement,
        priceDistanceKm: price.distanceKm, basis: price.basis, band: price.band, fareMinor: price.fareMinor,
    };
}

export type PaygQuote =
    | ({ ok: true; currency: string } & FareQuote)
    | { ok: false; reason: 'closed' | 'not_offered' | 'bad_location' | 'needs_pickup'; priceDistanceKm?: number; maxKm?: number };

export async function quotePaygRide(
    db: RidesDb,
    args: { tenantId: string; pickup?: Place | null; destination: Place; settings?: RideSettingsValues },
): Promise<PaygQuote> {
    if (!placeOk(args.destination) || (args.pickup && !placeOk(args.pickup))) return { ok: false, reason: 'bad_location' };
    const s = args.settings ?? (await getRideSettings(db, args.tenantId));
    if (!s.paygOpen) return { ok: false, reason: 'closed' };
    const price = priceTrip({ fareRef: s.fareRef, pickup: args.pickup, destination: args.destination, roadFactor: s.roadFactor, schedule: paygSchedule(s) });
    if (!price.ok) {
        return price.reason === 'not_offered'
            ? { ok: false, reason: 'not_offered', priceDistanceKm: price.distanceKm, maxKm: price.maxKm }
            : { ok: false, reason: price.reason };
    }
    return { ok: true, priceDistanceKm: price.distanceKm, basis: price.basis, band: price.band, fareMinor: price.fareMinor, currency: s.currency };
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
    | { ok: true; ride: RideWithRelations; settlement: Exclude<Settlement, { mode: 'no_balance' | 'topup' }> }
    | {
        ok: false;
        reason: 'no_package' | 'no_balance' | 'not_offered' | 'bad_location' | 'needs_pickup' | 'open_ride' | 'fare_changed' | 'needs_topup';
        priceDistanceKm?: number; maxKm?: number; fareMinor?: number; availableMinor?: number; topupMinor?: number;
    };

/**
 * Book a package ride paid from the balance alone (decision 4): the balance
 * covers the fare, or the difference is under GHS 2 and is waived. When it
 * needs a top-up, nothing is booked here (needs_topup): the flow sends a
 * ride_topup payment link instead (reserveTopupRide). `expectedFareMinor` is
 * the fare the customer was shown: a different fare now = fare_changed.
 */
export async function requestPackageRide(
    prisma: RidesClient,
    args: {
        tenantId: string; customerId: string; conversationId?: string | null; pickup: Place; destination: Place;
        expectedFareMinor?: number; source?: 'WHATSAPP' | 'APP' | 'CONSOLE'; now?: Date;
    },
): Promise<RequestRideResult> {
    const now = args.now ?? new Date();
    if (!placeOk(args.pickup)) return { ok: false, reason: 'bad_location' };
    return withRefRetry((ref) => prisma.$transaction(async (tx): Promise<RequestRideResult> => {
        await lockCustomer(tx, args.customerId);
        const s = await getRideSettings(tx, args.tenantId);
        const quote = await quotePackageRide(tx, { ...args, now, settings: s });
        if (!quote.ok) {
            return { ok: false, reason: quote.reason, priceDistanceKm: quote.priceDistanceKm, maxKm: quote.maxKm, fareMinor: quote.fareMinor, availableMinor: quote.availableMinor };
        }
        if (args.expectedFareMinor !== undefined && args.expectedFareMinor !== quote.fareMinor) return { ok: false, reason: 'fare_changed', fareMinor: quote.fareMinor };
        if ((await tx.ride.count({ where: inFlight(args.tenantId, args.customerId, now) })) > 0) return { ok: false, reason: 'open_ride' };
        const st = quote.settlement;
        if (st.mode === 'topup') {
            return { ok: false, reason: 'needs_topup', fareMinor: quote.fareMinor, availableMinor: quote.availableMinor, topupMinor: st.topupMinor };
        }
        const ride = await tx.ride.create({
            data: {
                tenantId: args.tenantId, ref, kind: 'PACKAGE', status: 'REQUESTED',
                customerId: args.customerId, conversationId: args.conversationId ?? null, passId: quote.passId,
                ...tripColumns(args.pickup, args.destination, s.roadFactor, { distanceKm: quote.priceDistanceKm, basis: quote.basis, band: quote.band, fareMinor: quote.fareMinor }),
                balanceAppliedMinor: st.balanceAppliedMinor, topupMinor: 0, waivedMinor: st.waivedMinor,
                currency: s.currency, source: args.source ?? 'WHATSAPP', requestedAt: now,
            },
            include: rideInclude,
        });
        return { ok: true, ride, settlement: st };
    }));
}

// ---------------------------------------------------------------- package top-up (ride_topup)

export type ReserveTopupResult =
    | { ok: true; ride: Ride; reused: boolean }
    | { ok: false; reason: 'no_package' | 'no_balance' | 'not_offered' | 'bad_location' | 'needs_pickup' | 'open_ride' | 'fare_changed' | 'hold_limit' };

/**
 * When the link for a top-up is created: re-price the trip and create the
 * PENDING_PAYMENT package ride that holds the customer's whole remaining
 * balance (balanceAppliedMinor) until the difference (topupMinor) is paid. The
 * amount on the link must equal that difference, else fare_changed (the
 * customer is shown the new numbers). The customer's own live top-up ride is
 * re-used, never duplicated.
 */
export async function reserveTopupRide(
    prisma: RidesClient,
    args: {
        tenantId: string; customerId: string; conversationId?: string | null; pickup: Place; destination: Place;
        expectedTopupMinor: number; expectedFareMinor?: number; source?: 'WHATSAPP' | 'APP' | 'CONSOLE'; now?: Date;
    },
): Promise<ReserveTopupResult> {
    const now = args.now ?? new Date();
    if (!placeOk(args.pickup)) return { ok: false, reason: 'bad_location' };
    return withRefRetry((ref) => prisma.$transaction(async (tx): Promise<ReserveTopupResult> => {
        await lockCustomer(tx, args.customerId);
        const s = await getRideSettings(tx, args.tenantId);
        const pending = await tx.ride.findFirst({
            where: { tenantId: args.tenantId, customerId: args.customerId, kind: 'PACKAGE', status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } },
            orderBy: { createdAt: 'desc' },
        });
        const quote = await quotePackageRide(tx, { ...args, now, settings: s, excludeRideId: pending?.id });
        if (!quote.ok) return { ok: false, reason: quote.reason };
        const st = quote.settlement;
        if (st.mode !== 'topup' || st.topupMinor !== args.expectedTopupMinor) return { ok: false, reason: 'fare_changed' };
        if (args.expectedFareMinor !== undefined && args.expectedFareMinor !== quote.fareMinor) return { ok: false, reason: 'fare_changed' };
        if ((await tx.ride.count({ where: inFlight(args.tenantId, args.customerId, now, pending?.id) })) > 0) return { ok: false, reason: 'open_ride' };

        const paymentExpiresAt = new Date(now.getTime() + s.holdMinutes * 60_000);
        const details = {
            conversationId: args.conversationId ?? null, passId: quote.passId,
            ...tripColumns(args.pickup, args.destination, s.roadFactor, { distanceKm: quote.priceDistanceKm, basis: quote.basis, band: quote.band, fareMinor: quote.fareMinor }),
            balanceAppliedMinor: st.balanceAppliedMinor, topupMinor: st.topupMinor, waivedMinor: 0,
            currency: s.currency,
        };
        if (pending) {
            const lifetimeEnd = pending.requestedAt.getTime() + HOLD_LIFETIME_FACTOR * s.holdMinutes * 60_000;
            const keepUntil = new Date(Math.max(pending.paymentExpiresAt!.getTime(), Math.min(paymentExpiresAt.getTime(), lifetimeEnd)));
            const ride = await tx.ride.update({ where: { id: pending.id, tenantId: args.tenantId }, data: { ...details, paymentExpiresAt: keepUntil } });
            return { ok: true, ride, reused: true };
        }
        const timedOutToday = await tx.ride.count({
            where: {
                tenantId: args.tenantId, customerId: args.customerId, kind: 'PACKAGE', paidAt: null,
                status: 'CANCELLED', cancelReason: 'payment_timeout',
                requestedAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) },
            },
        });
        if (timedOutToday >= MAX_UNPAID_HOLDS_PER_DAY) return { ok: false, reason: 'hold_limit' };
        const ride = await tx.ride.create({
            data: {
                tenantId: args.tenantId, ref, kind: 'PACKAGE', status: 'PENDING_PAYMENT', customerId: args.customerId,
                ...details, paymentExpiresAt, source: args.source ?? 'WHATSAPP', requestedAt: now,
            },
        });
        return { ok: true, ride, reused: false };
    }));
}

export type TopupPaymentOutcome =
    | { outcome: 'confirmed'; ride: Ride }
    | { outcome: 'already_confirmed'; ride: Ride }
    | { outcome: 'already_refused'; ride: Ride; reason: string }
    | { outcome: 'refused'; ride: Ride; reason: 'pass_inactive' | 'balance_changed' | 'open_ride' | 'paid_twice' | 'not_payable' }
    | { outcome: 'underpaid'; ride: Ride }
    | { outcome: 'not_found' };

/** Why a paid top-up cannot be booked now, or null when it can. */
async function topupBlocker(tx: RidesDb, ride: Ride, now: Date, revive: boolean): Promise<'pass_inactive' | 'balance_changed' | 'open_ride' | null> {
    const pass = ride.passId ? await tx.ridePass.findFirst({ where: { id: ride.passId, tenantId: ride.tenantId } }) : null;
    // A live hold was taken while the pass was active (the sweeper does not expire a pass under a live top-up);
    // reviving a lapsed one needs the pass to be active right now.
    if (!pass || pass.status !== 'ACTIVE' || (revive && (!pass.expiresAt || pass.expiresAt <= now))) return 'pass_inactive';
    if ((await tx.ride.count({ where: inFlight(ride.tenantId, ride.customerId, now, ride.id) })) > 0) return 'open_ride';
    if ((await availableMinor(tx, pass as RidePass, now, ride.id)) < (ride.balanceAppliedMinor ?? 0)) return 'balance_changed';
    return null;
}

/**
 * Confirm a package top-up ride on a VERIFIED payment. Idempotent per
 * reference. The paid amount is checked against the ride's topupMinor (never
 * metadata). A payment for a top-up whose link already expired re-books the
 * ride only if the pass is still active, the balance still covers its share
 * and no other ride is in progress; otherwise it is recorded on the row
 * (refund due), not confirmed, and the caller alerts.
 */
export async function confirmTopupOnPayment(
    prisma: RidesClient,
    args: { tenantId: string; rideId: string; reference: string; amountMinor: number; currency: string; transactionId?: string; channel?: string; now?: Date },
): Promise<TopupPaymentOutcome> {
    const now = args.now ?? new Date();
    return prisma.$transaction(async (tx): Promise<TopupPaymentOutcome> => {
        const found = await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId, kind: 'PACKAGE', topupMinor: { gt: 0 } } });
        if (!found) return { outcome: 'not_found' };
        await lockCustomer(tx, found.customerId);
        await tx.$queryRaw`SELECT id FROM "Ride" WHERE id = ${args.rideId} AND "tenantId" = ${args.tenantId} FOR UPDATE`;
        const ride = (await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId } }))!;

        if (ride.paidAt && ride.paymentReference === args.reference) {
            return ride.status === 'CANCELLED' && ride.cancelReason?.startsWith('paid_')
                ? { outcome: 'already_refused', ride, reason: ride.cancelReason }
                : { outcome: 'already_confirmed', ride };
        }
        if (ride.paidAt) return { outcome: 'refused', ride, reason: 'paid_twice' };
        if (args.currency.toUpperCase() !== ride.currency.toUpperCase() || args.amountMinor < (ride.topupMinor ?? 0) - AMOUNT_TOLERANCE_MINOR) {
            return { outcome: 'underpaid', ride };
        }
        const paid = { paymentReference: args.reference, paidAt: now, paidAmountMinor: args.amountMinor, providerTransactionId: args.transactionId ?? null, paymentChannel: args.channel ?? null, paymentExpiresAt: null };
        const live = ride.status === 'PENDING_PAYMENT';
        const revive = ride.status === 'CANCELLED' && ride.cancelReason === 'payment_timeout';
        if (!live && !revive) {
            const updated = await tx.ride.update({
                where: { id: ride.id, tenantId: args.tenantId },
                data: { ...paid, ...(ride.status === 'CANCELLED' ? { cancelReason: 'paid_after_cancel' } : {}) },
            });
            return { outcome: 'refused', ride: updated, reason: 'not_payable' };
        }
        const blocker = await topupBlocker(tx, ride, now, revive);
        if (blocker) {
            const updated = await tx.ride.update({
                where: { id: ride.id, tenantId: args.tenantId },
                data: { ...paid, status: 'CANCELLED', cancelledAt: ride.cancelledAt ?? now, cancelReason: `paid_${blocker}` },
            });
            return { outcome: 'refused', ride: updated, reason: blocker };
        }
        const updated = await tx.ride.update({
            where: { id: ride.id, tenantId: args.tenantId },
            data: { ...paid, status: 'REQUESTED', requestedAt: now, cancelledAt: null, cancelReason: null },
        });
        return { outcome: 'confirmed', ride: updated };
    });
}

// ---------------------------------------------------------------- PAYG

export type ReservePaygResult =
    | { ok: true; ride: Ride; reused: boolean }
    | { ok: false; reason: 'closed' | 'full' | 'not_offered' | 'bad_location' | 'needs_pickup' | 'open_ride' | 'fare_changed' | 'hold_limit' };

/**
 * Reserve today's PAYG capacity and create the PENDING_PAYMENT ride, in one
 * transaction, when the payment link is created. The customer's own unpaid
 * PAYG ride is re-used (keeping its slot), so asking for a new link never takes
 * a second slot. Unpaid by paymentExpiresAt: the sweeper cancels it and gives
 * the slot back. A package top-up still waiting for its payment is a ride in
 * flight: no PAYG booking beside it.
 */
export async function reservePaygRide(
    prisma: RidesClient,
    args: { tenantId: string; customerId: string; conversationId?: string | null; pickup: Place; destination: Place; expectedFareMinor?: number; source?: 'WHATSAPP' | 'APP' | 'CONSOLE'; now?: Date },
): Promise<ReservePaygResult> {
    const now = args.now ?? new Date();
    if (!placeOk(args.pickup)) return { ok: false, reason: 'bad_location' };
    return withRefRetry((ref) => prisma.$transaction(async (tx): Promise<ReservePaygResult> => {
        await lockCustomer(tx, args.customerId);
        const s = await getRideSettings(tx, args.tenantId);
        const quote = await quotePaygRide(tx, { ...args, settings: s });
        if (!quote.ok) return { ok: false, reason: quote.reason };
        if (args.expectedFareMinor !== undefined && args.expectedFareMinor !== quote.fareMinor) return { ok: false, reason: 'fare_changed' };
        const open = await tx.ride.count({
            where: {
                tenantId: args.tenantId, customerId: args.customerId,
                OR: [{ status: { in: OPEN_STATUSES } }, { kind: 'PACKAGE', status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } }],
            },
        });
        if (open > 0) return { ok: false, reason: 'open_ride' };

        const paymentExpiresAt = new Date(now.getTime() + s.holdMinutes * 60_000);
        const details = {
            conversationId: args.conversationId ?? null,
            ...tripColumns(args.pickup, args.destination, s.roadFactor, { distanceKm: quote.priceDistanceKm, basis: quote.basis, band: quote.band, fareMinor: quote.fareMinor }),
            currency: quote.currency, paymentExpiresAt,
        };

        const pending = await tx.ride.findFirst({
            where: { tenantId: args.tenantId, customerId: args.customerId, kind: 'PAYG', status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } },
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
    /** COMPLETED package ride: the RIDE entry was written by THIS call. */
    deducted: boolean;
    /** COMPLETED package ride: pesewas taken off the balance (by this call or an earlier one), else null. */
    deductedMinor: number | null;
    /** Package balance after the change (package rides only), pesewas. */
    balanceAfterMinor: number | null;
    /** A paid PAYG ride, or a package ride whose top-up was paid, was cancelled: the tenant owes a refund. */
    refundDue: boolean;
    /** The amount to refund (pesewas) when refundDue. */
    refundMinor: number | null;
    previousStatus: RideStatus;
}

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

/** What completing this package ride takes off the balance. */
export function deductionMinor(ride: Pick<Ride, 'balanceAppliedMinor'>, pass: Pick<RidePass, 'priceMinor' | 'ridesTotal'>): number {
    return ride.balanceAppliedMinor ?? legacyRideFareMinor(pass);
}

/**
 * Move a ride to EN_ROUTE / COMPLETED / CANCELLED. Repeating the same change
 * is a no-op success (changed: false), so a double click on COMPLETED is safe
 * and deducts once. Any other transition is refused (invalid_state).
 */
export async function setRideStatus(
    prisma: RidesClient,
    args: { tenantId: string; rideId: string; status: StatusChange; reason?: string | null; by?: 'ops' | 'customer' | 'system'; now?: Date },
): Promise<DispatchResult<StatusOutcome>> {
    const now = args.now ?? new Date();
    const by = args.by ?? 'ops';
    // A customer can only cancel, and only before a driver is assigned.
    if (by === 'customer' && args.status !== 'CANCELLED') return { ok: false, error: 'invalid_state' };
    const result = await prisma.$transaction(async (tx) => {
        const owner = await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, select: { customerId: true } });
        if (!owner) return { ok: false as const, error: 'not_found' as const };
        // Same lock as booking and the payment confirmations: a completion never races a booking's balance
        // check, and a cancel never races a payment confirming this ride.
        await lockCustomer(tx, owner.customerId);
        await tx.$queryRaw`SELECT id FROM "Ride" WHERE id = ${args.rideId} AND "tenantId" = ${args.tenantId} FOR UPDATE`;
        // Read AFTER the lock: a payment that committed while we waited (paidAt, REQUESTED) must decide
        // refundDue / refundMinor below; a row read before the lock would say "unpaid" and lose the refund.
        const before = await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId } });
        if (!before) return { ok: false as const, error: 'not_found' as const };
        const from = by === 'customer' ? (['REQUESTED'] as RideStatus[]) : FROM[args.status];
        const data: Prisma.RideUncheckedUpdateManyInput =
            args.status === 'EN_ROUTE' ? { status: 'EN_ROUTE', enRouteAt: now }
                : args.status === 'COMPLETED' ? { status: 'COMPLETED', completedAt: now }
                    : { status: 'CANCELLED', cancelledAt: now, cancelReason: cancelReasonFor(by, args.reason) };
        const claimed = await tx.ride.updateMany({ where: { id: args.rideId, tenantId: args.tenantId, status: { in: from } }, data });
        if (claimed.count === 0) {
            // `before` may be stale: a concurrent caller can have committed the change while we waited on the lock.
            const current = (await tx.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, select: { status: true } }))?.status ?? before.status;
            if (current === args.status) {
                return { ok: true as const, changed: false, deducted: false, refundDue: false, refundMinor: null, shortfallMinor: 0, previousStatus: current, passId: before.passId };
            }
            return { ok: false as const, error: 'invalid_state' as const, status: current };
        }

        let deducted = false;
        let shortfallMinor = 0;
        if (args.status === 'COMPLETED' && before.kind === 'PACKAGE' && before.passId) {
            const pass = await tx.ridePass.findFirst({ where: { id: before.passId, tenantId: args.tenantId } });
            const wanted = pass ? deductionMinor(before, pass) : before.balanceAppliedMinor ?? 0;
            // Never below zero: the reservation should make this impossible, so a shortfall (a manual
            // adjustment, a legacy ride) is deducted only down to 0 and raised as an alert below.
            const { remainingMinor } = await passBalance(tx, args.tenantId, before.passId);
            const amount = Math.min(wanted, Math.max(0, remainingMinor));
            shortfallMinor = wanted - amount;
            try {
                await tx.ridePassEntry.create({ data: { tenantId: args.tenantId, passId: before.passId, type: 'RIDE', amountMinor: -amount, rideId: before.id } });
                deducted = true;
            } catch (err) {
                // UNIQUE(rideId): already deducted. Cannot happen behind the claim above; never deduct twice regardless.
                if (!isUniqueViolation(err)) throw err;
                throw new Error('ride_already_deducted');
            }
            const after = await passBalance(tx, args.tenantId, before.passId);
            await tx.ride.update({ where: { id: before.id, tenantId: args.tenantId }, data: { deductedMinor: amount, balanceAfterMinor: after.remainingMinor } });
        }
        if (args.status === 'CANCELLED' && before.kind === 'PAYG' && before.paygDay) {
            await releasePaygSlot(tx, args.tenantId, before.paygDay);
        }
        const refundDue = args.status === 'CANCELLED' && !!before.paidAt && (before.kind === 'PAYG' || (before.topupMinor ?? 0) > 0);
        const refundMinor = refundDue ? before.paidAmountMinor ?? (before.kind === 'PAYG' ? before.fareMinor : before.topupMinor) : null;
        return { ok: true as const, changed: true, deducted, refundDue, refundMinor, shortfallMinor, previousStatus: before.status, passId: before.passId };
    });
    if (!result.ok) return result;
    if (result.shortfallMinor > 0) {
        const short = await prisma.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, select: { ref: true, currency: true, customerId: true } });
        const amount = money(result.shortfallMinor, short?.currency ?? 'GHS');
        await raiseAlert(prisma, {
            kind: 'ride_pass.deduction_shortfall', severity: 'critical', tenantId: args.tenantId,
            message: `Ride ${short?.ref ?? args.rideId} completed, but the package balance was ${amount} short of what the ride held. Only the balance left was deducted; ${amount} was not collected.`,
            context: { rideId: args.rideId, passId: result.passId, customerId: short?.customerId, shortfallMinor: result.shortfallMinor },
            dedupeKey: `ride_pass.deduction_shortfall:${args.tenantId}:${args.rideId}`,
        });
    }

    const ride = await prisma.ride.findFirst({ where: { id: args.rideId, tenantId: args.tenantId }, include: rideInclude });
    if (!ride) return { ok: false, error: 'not_found' };
    const balanceAfterMinor = ride.kind === 'PACKAGE' && result.passId ? (await passBalance(prisma, args.tenantId, result.passId)).remainingMinor : null;
    return {
        ok: true, ride, changed: result.changed, deducted: result.deducted,
        deductedMinor: ride.status === 'COMPLETED' ? ride.deductedMinor : null,
        balanceAfterMinor, refundDue: result.refundDue, refundMinor: result.refundMinor ?? null,
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
