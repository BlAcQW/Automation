/**
 * Ride packages ("Founding 50"): the cap with payment holds, activation on a
 * verified payment, and the balance (an append-only log, SUM of entries).
 *
 * THE CAP. "Only 50 Founding Packages": a slot is taken for good by any pass
 * that was ever activated (an expired package does not reopen it), and for
 * the length of the hold by a HELD pass whose hold has not lapsed. Every decision that can take a slot (a new hold, re-taking a
 * lapsed hold, activating a late payment) runs inside one transaction holding
 * a per-tenant advisory lock, so two customers racing for the 50th slot cannot
 * both get it: the second waits for the first to commit, then counts 50.
 *
 * ACTIVATION happens ONLY here, ONLY from a verified payment (the ride_package
 * fulfiller), and is idempotent per payment reference.
 *
 * GHS CREDIT. A package is ride credit (creditMinor, = the price paid). The
 * log is in signed pesewas (amountMinor): +credit on activation, -fare when a
 * ride completes, -rest on expiry. What a new booking may use (availableMinor)
 * is the remaining balance less the credit open bookings already hold.
 */
import type { RidePass } from '@prisma/client';
import type { RidesClient, RidesDb } from './db.js';
import { getRideSettings, type RideSettingsValues } from './settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same one-minor-unit rounding tolerance as the other payment fulfillers. */
export const AMOUNT_TOLERANCE_MINOR = 1;
export const PASS_DISPLAY_NAME = 'Pioneer 50';

async function lockCap(tx: RidesDb, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ride_cap:' + tenantId}, 0))`;
}

/** Slots taken: ever activated + unexpired HELD (optionally ignoring one pass). */
export async function slotsTaken(db: RidesDb, tenantId: string, now: Date, excludeId?: string): Promise<number> {
    return db.ridePass.count({
        where: {
            tenantId,
            ...(excludeId ? { id: { not: excludeId } } : {}),
            OR: [{ activatedAt: { not: null } }, { status: 'HELD', holdExpiresAt: { gt: now } }],
        },
    });
}

export interface FoundingAvailability {
    cap: number;
    taken: number;
    left: number;
    available: boolean;
}

export async function foundingAvailability(db: RidesDb, tenantId: string, now = new Date(), settings?: RideSettingsValues): Promise<FoundingAvailability> {
    const s = settings ?? (await getRideSettings(db, tenantId));
    const taken = await slotsTaken(db, tenantId, now);
    const left = Math.max(0, s.foundingCap - taken);
    return { cap: s.foundingCap, taken, left, available: left > 0 };
}

export async function findActivePass(db: RidesDb, tenantId: string, customerId: string, now = new Date()): Promise<RidePass | null> {
    return db.ridePass.findFirst({
        where: { tenantId, customerId, status: 'ACTIVE', expiresAt: { gt: now } },
        orderBy: { activatedAt: 'desc' },
    });
}

export type HoldResult =
    | { ok: true; pass: RidePass; reused: boolean }
    | { ok: false; reason: 'sold_out' | 'has_active' | 'hold_limit' };

/**
 * Anti-squatting. A hold takes a slot without money, so: a customer whose
 * holds lapsed unpaid this many times in 24 hours cannot start another until
 * the window passes, and asking again for a link never keeps one hold alive
 * for longer than HOLD_LIFETIME_FACTOR x holdMinutes.
 */
export const MAX_UNPAID_HOLDS_PER_DAY = 3;
export const HOLD_LIFETIME_FACTOR = 2;

/**
 * Hold a Founding slot for a customer about to pay. Re-uses (and extends) the
 * customer's own HELD pass, so asking for a second link never takes a second
 * slot. A lapsed hold is re-taken only if a slot is free.
 */
export async function holdFoundingSlot(
    prisma: RidesClient,
    args: { tenantId: string; customerId: string; conversationId?: string | null; now?: Date },
): Promise<HoldResult> {
    const now = args.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        await lockCap(tx, args.tenantId);
        const s = await getRideSettings(tx, args.tenantId);
        if (await findActivePass(tx, args.tenantId, args.customerId, now)) return { ok: false, reason: 'has_active' } as const;

        const holdExpiresAt = new Date(now.getTime() + s.holdMinutes * 60_000);
        const held = await tx.ridePass.findFirst({
            where: { tenantId: args.tenantId, customerId: args.customerId, status: 'HELD' },
            orderBy: { createdAt: 'desc' },
        });
        if (held && held.holdExpiresAt && held.holdExpiresAt > now) {
            // Asking again during a live hold re-uses it, but never past its lifetime cap.
            const lifetimeEnd = new Date(held.createdAt.getTime() + HOLD_LIFETIME_FACTOR * s.holdMinutes * 60_000);
            const extended = new Date(Math.max(held.holdExpiresAt.getTime(), Math.min(holdExpiresAt.getTime(), lifetimeEnd.getTime())));
            // Terms are refreshed to today's settings: the link about to be made charges today's price.
            const pass = await tx.ridePass.update({
                where: { id: held.id, tenantId: args.tenantId },
                data: {
                    status: 'HELD', cancelledAt: null, cancelReason: null,
                    holdExpiresAt: extended,
                    conversationId: args.conversationId ?? held.conversationId,
                    ridesTotal: s.packageRides, validityDays: s.validityDays, maxKm: s.maxKm,
                    priceMinor: s.packagePriceMinor, creditMinor: s.packagePriceMinor, currency: s.currency,
                },
            });
            return { ok: true, pass, reused: true } as const;
        }
        if (held) {
            // A lapsed hold is closed here (as the sweeper would), so every new attempt is its own row and counts.
            await tx.ridePass.updateMany({
                where: { id: held.id, tenantId: args.tenantId, status: 'HELD', paidAt: null },
                data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'hold_expired' },
            });
        }
        const lapsedToday = await tx.ridePass.count({
            where: {
                tenantId: args.tenantId, customerId: args.customerId, paidAt: null,
                status: 'CANCELLED', cancelReason: 'hold_expired',
                createdAt: { gt: new Date(now.getTime() - DAY_MS) },
            },
        });
        if (lapsedToday >= MAX_UNPAID_HOLDS_PER_DAY) return { ok: false, reason: 'hold_limit' } as const;

        if ((await slotsTaken(tx, args.tenantId, now)) >= s.foundingCap) return { ok: false, reason: 'sold_out' } as const;
        const pass = await tx.ridePass.create({
            data: {
                tenantId: args.tenantId,
                customerId: args.customerId,
                conversationId: args.conversationId ?? null,
                status: 'HELD',
                ridesTotal: s.packageRides,
                validityDays: s.validityDays,
                maxKm: s.maxKm,
                priceMinor: s.packagePriceMinor,
                creditMinor: s.packagePriceMinor,
                currency: s.currency,
                holdExpiresAt,
                createdAt: now,
            },
        });
        return { ok: true, pass, reused: false } as const;
    });
}

/** Record the payment link's reference on the held pass (shown in the console while pending). */
export async function recordPassLink(db: RidesDb, tenantId: string, passId: string, reference: string): Promise<void> {
    await db.ridePass.updateMany({ where: { id: passId, tenantId, paidAt: null }, data: { paymentReference: reference } });
}

export type ActivationOutcome =
    | { outcome: 'activated'; pass: RidePass }
    | { outcome: 'already_activated'; pass: RidePass }
    | { outcome: 'already_refused'; pass: RidePass; reason: string }
    | { outcome: 'refused'; pass: RidePass; reason: 'cap_full' | 'has_active' | 'paid_twice' }
    | { outcome: 'underpaid'; pass: RidePass }
    | { outcome: 'not_found' };

/**
 * Apply a VERIFIED payment to a pass. Idempotent per reference: a redelivery
 * returns already_activated / already_refused and changes nothing.
 *
 * A payment that cannot be honoured (the hold lapsed and the cap is now full,
 * the customer already has an active package) is recorded on the pass
 * (reference, paidAt, CANCELLED + reason) so it is traceable and refundable,
 * and is NOT activated. The caller alerts.
 */
export async function activatePassOnPayment(
    prisma: RidesClient,
    args: { tenantId: string; passId: string; reference: string; amountMinor: number; currency: string; transactionId?: string; channel?: string; now?: Date },
): Promise<ActivationOutcome> {
    const now = args.now ?? new Date();
    return prisma.$transaction(async (tx): Promise<ActivationOutcome> => {
        await lockCap(tx, args.tenantId);
        const pass = await tx.ridePass.findFirst({ where: { id: args.passId, tenantId: args.tenantId } });
        if (!pass) return { outcome: 'not_found' };

        if (pass.paidAt && pass.paymentReference === args.reference) {
            return pass.activatedAt
                ? { outcome: 'already_activated', pass }
                : { outcome: 'already_refused', pass, reason: pass.cancelReason ?? 'refused' };
        }
        if (pass.paidAt) return { outcome: 'refused', pass, reason: 'paid_twice' };

        if (args.currency.toUpperCase() !== pass.currency.toUpperCase() || args.amountMinor < pass.priceMinor - AMOUNT_TOLERANCE_MINOR) {
            return { outcome: 'underpaid', pass };
        }

        const paid = { paymentReference: args.reference, paidAt: now, paidAmountMinor: args.amountMinor, providerTransactionId: args.transactionId ?? null, paymentChannel: args.channel ?? null };
        const refuse = async (reason: 'cap_full' | 'has_active'): Promise<ActivationOutcome> => {
            const updated = await tx.ridePass.update({
                where: { id: pass.id, tenantId: args.tenantId },
                data: { ...paid, status: 'CANCELLED', cancelledAt: now, cancelReason: reason === 'cap_full' ? 'cap_full_after_hold' : 'duplicate_purchase', holdExpiresAt: null },
            });
            return { outcome: 'refused', pass: updated, reason };
        };

        const otherActive = await tx.ridePass.count({
            where: { tenantId: args.tenantId, customerId: pass.customerId, status: 'ACTIVE', expiresAt: { gt: now }, id: { not: pass.id } },
        });
        if (otherActive > 0) return refuse('has_active');

        const holdLive = pass.status === 'HELD' && !!pass.holdExpiresAt && pass.holdExpiresAt > now;
        if (!holdLive) {
            const s = await getRideSettings(tx, args.tenantId);
            if ((await slotsTaken(tx, args.tenantId, now, pass.id)) >= s.foundingCap) return refuse('cap_full');
        }

        const activated = await tx.ridePass.update({
            where: { id: pass.id, tenantId: args.tenantId },
            data: {
                ...paid,
                status: 'ACTIVE',
                activatedAt: now,
                expiresAt: new Date(now.getTime() + pass.validityDays * DAY_MS),
                holdExpiresAt: null,
                cancelledAt: null,
                cancelReason: null,
                creditMinor: passCreditMinor(pass),
            },
        });
        await tx.ridePassEntry.create({
            data: { tenantId: args.tenantId, passId: pass.id, type: 'PURCHASE', amountMinor: passCreditMinor(pass), reference: args.reference },
        });
        return { outcome: 'activated', pass: activated };
    });
}

// ---------------------------------------------------------------- balance

/** The GHS credit a pass carries (pesewas). Rows from before the credit change: the price paid. */
export function passCreditMinor(p: Pick<RidePass, 'creditMinor' | 'priceMinor'>): number {
    return p.creditMinor ?? p.priceMinor;
}

/**
 * What a ride booked under the old ride-count packages (no balanceAppliedMinor)
 * costs from the credit: the package's average price per ride.
 */
export function legacyRideFareMinor(p: Pick<RidePass, 'priceMinor' | 'ridesTotal'>): number {
    return Math.round(p.priceMinor / Math.max(1, p.ridesTotal));
}

export interface PassBalance {
    /** Credit added (PURCHASE + positive adjustments), pesewas. */
    purchasedMinor: number;
    /** Deducted by completed rides, pesewas (positive). */
    usedMinor: number;
    /** SUM of every entry (pesewas): what is left on the pass. */
    remainingMinor: number;
    /** Completed rides that deducted (count of RIDE entries). */
    ridesTaken: number;
}

const EMPTY_BALANCE: PassBalance = { purchasedMinor: 0, usedMinor: 0, remainingMinor: 0, ridesTaken: 0 };

export async function passBalances(db: RidesDb, tenantId: string, passIds: string[]): Promise<Map<string, PassBalance>> {
    const out = new Map<string, PassBalance>();
    if (passIds.length === 0) return out;
    const rows = await db.ridePassEntry.groupBy({
        by: ['passId', 'type'],
        where: { tenantId, passId: { in: passIds } },
        _sum: { amountMinor: true },
        _count: { _all: true },
    });
    for (const id of passIds) out.set(id, { ...EMPTY_BALANCE });
    for (const r of rows) {
        const b = out.get(r.passId)!;
        const sum = r._sum.amountMinor ?? 0;
        const next: PassBalance = {
            purchasedMinor: b.purchasedMinor + (r.type === 'PURCHASE' || (r.type === 'ADJUSTMENT' && sum > 0) ? sum : 0),
            usedMinor: b.usedMinor + (r.type === 'RIDE' ? -sum : 0),
            remainingMinor: b.remainingMinor + sum,
            ridesTaken: b.ridesTaken + (r.type === 'RIDE' ? r._count._all : 0),
        };
        out.set(r.passId, next);
    }
    return out;
}

export async function passBalance(db: RidesDb, tenantId: string, passId: string): Promise<PassBalance> {
    return (await passBalances(db, tenantId, [passId])).get(passId)!;
}

/** Ride states that hold credit until they complete or are cancelled. */
const OPEN_RIDE_STATUSES = ['REQUESTED', 'ASSIGNED', 'EN_ROUTE'] as const;

/**
 * Credit reserved by the pass's rides that will deduct when they complete: open
 * rides, and a top-up ride whose payment link is still live. A ride that is
 * excluded (the one being re-quoted or confirmed) does not count.
 */
export async function reservedMinor(
    db: RidesDb,
    pass: Pick<RidePass, 'id' | 'tenantId' | 'priceMinor' | 'ridesTotal'>,
    now: Date,
    excludeRideId?: string,
): Promise<number> {
    const rides = await db.ride.findMany({
        where: {
            tenantId: pass.tenantId, passId: pass.id, kind: 'PACKAGE',
            ...(excludeRideId ? { id: { not: excludeRideId } } : {}),
            OR: [{ status: { in: [...OPEN_RIDE_STATUSES] } }, { status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } }],
        },
        select: { balanceAppliedMinor: true },
        take: 50,
    });
    return rides.reduce((sum, r) => sum + (r.balanceAppliedMinor ?? legacyRideFareMinor(pass)), 0);
}

/** Balance a new booking may use: what is left minus what open bookings already hold. */
export async function availableMinor(db: RidesDb, pass: RidePass, now: Date, excludeRideId?: string): Promise<number> {
    const [b, reserved] = await Promise.all([passBalance(db, pass.tenantId, pass.id), reservedMinor(db, pass, now, excludeRideId)]);
    return b.remainingMinor - reserved;
}

export interface CustomerBalance extends PassBalance {
    pass: RidePass | null;
    /** True when the customer holds an ACTIVE, unexpired package. */
    active: boolean;
    /** remainingMinor less what open bookings hold (0 when not active). */
    availableMinor: number;
    expiresAt: Date | null;
}

/** The customer's current package: the active one, else the most recent paid one. */
export async function customerBalance(db: RidesDb, tenantId: string, customerId: string, now = new Date()): Promise<CustomerBalance> {
    const active = await findActivePass(db, tenantId, customerId, now);
    const pass = active ?? (await db.ridePass.findFirst({
        where: { tenantId, customerId, activatedAt: { not: null } },
        orderBy: { activatedAt: 'desc' },
    }));
    if (!pass) return { pass: null, active: false, ...EMPTY_BALANCE, availableMinor: 0, expiresAt: null };
    const b = await passBalance(db, tenantId, pass.id);
    const available = active ? b.remainingMinor - (await reservedMinor(db, pass, now)) : 0;
    return { pass, active: !!active, ...b, availableMinor: available, expiresAt: pass.expiresAt };
}
