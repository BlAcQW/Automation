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
                    priceMinor: s.packagePriceMinor, currency: s.currency,
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
            },
        });
        await tx.ridePassEntry.create({
            data: { tenantId: args.tenantId, passId: pass.id, type: 'PURCHASE', delta: pass.ridesTotal, reference: args.reference },
        });
        return { outcome: 'activated', pass: activated };
    });
}

// ---------------------------------------------------------------- balance

export interface PassBalance {
    purchased: number;
    used: number;
    remaining: number;
}

export async function passBalances(db: RidesDb, tenantId: string, passIds: string[]): Promise<Map<string, PassBalance>> {
    const out = new Map<string, PassBalance>();
    if (passIds.length === 0) return out;
    const rows = await db.ridePassEntry.groupBy({
        by: ['passId', 'type'],
        where: { tenantId, passId: { in: passIds } },
        _sum: { delta: true },
    });
    for (const id of passIds) out.set(id, { purchased: 0, used: 0, remaining: 0 });
    for (const r of rows) {
        const b = out.get(r.passId)!;
        const sum = r._sum.delta ?? 0;
        if (r.type === 'PURCHASE') b.purchased += sum;
        if (r.type === 'RIDE') b.used += -sum;
        b.remaining += sum;
    }
    return out;
}

export async function passBalance(db: RidesDb, tenantId: string, passId: string): Promise<PassBalance> {
    return (await passBalances(db, tenantId, [passId])).get(passId)!;
}

export interface CustomerBalance {
    pass: RidePass | null;
    /** True when the customer holds an ACTIVE, unexpired package. */
    active: boolean;
    purchased: number;
    used: number;
    remaining: number;
    expiresAt: Date | null;
}

/** The customer's current package: the active one, else the most recent paid one. */
export async function customerBalance(db: RidesDb, tenantId: string, customerId: string, now = new Date()): Promise<CustomerBalance> {
    const active = await findActivePass(db, tenantId, customerId, now);
    const pass = active ?? (await db.ridePass.findFirst({
        where: { tenantId, customerId, activatedAt: { not: null } },
        orderBy: { activatedAt: 'desc' },
    }));
    if (!pass) return { pass: null, active: false, purchased: 0, used: 0, remaining: 0, expiresAt: null };
    const b = await passBalance(db, tenantId, pass.id);
    return { pass, active: !!active, ...b, expiresAt: pass.expiresAt };
}
