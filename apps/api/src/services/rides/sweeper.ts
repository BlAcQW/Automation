/**
 * Rides sweeper (background task 'ride-sweeper', every minute):
 *
 *  1. lapsed Founding holds   HELD past holdExpiresAt, unpaid       -> CANCELLED (hold_expired)
 *  2. unpaid PAYG rides       PENDING_PAYMENT past paymentExpiresAt -> CANCELLED (payment_timeout),
 *                             and that day's PAYG seat is given back, in the same transaction
 *  3. expired packages        ACTIVE past expiresAt (and no ride in progress) -> EXPIRED, with an
 *                             EXPIRY entry taking the unused rides off the balance
 *  4. reminders, once each    "expires soon" 10 days before expiry (day 50 of 60), and
 *                             "5 rides left"
 *
 * MULTI-PROCESS SAFE. Every change is a guarded updateMany claim (WHERE the old
 * state still holds); only the caller that sees count 1 does the follow-up
 * (seat release, EXPIRY entry, reminder), inside the same transaction where it
 * writes. A payment landing mid-sweep flips the row first, so the claim finds
 * nothing. Runs without tenant context (worker), filtering by state; every
 * follow-up write names the row's tenant.
 */
import type { RidesClient } from './db.js';
import { getRideSettings } from './settings.js';
import { passBalance, passBalances } from './passes.js';
import { releasePaygSlot } from './capacity.js';
import { OPEN_STATUSES, lockCustomer } from './rides.js';
import { notifyRideCustomer, type RidesLogger } from './notify.js';
import { expiryReminderText, lowBalanceText } from './texts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60_000;
const BATCH = 100;
export const EXPIRY_REMINDER_DAYS_BEFORE = 10;
export const LOW_BALANCE_AT = 5;

export interface SweepResult {
    cancelledHolds: number;
    expiredPayg: number;
    expiredPasses: number;
    expiryReminders: number;
    lowBalanceReminders: number;
}

export async function sweepRides(prisma: RidesClient, log: RidesLogger, now = new Date()): Promise<SweepResult> {
    const out: SweepResult = { cancelledHolds: 0, expiredPayg: 0, expiredPasses: 0, expiryReminders: 0, lowBalanceReminders: 0 };
    const zones = new Map<string, string>();
    const zone = async (tenantId: string) => {
        if (!zones.has(tenantId)) zones.set(tenantId, (await getRideSettings(prisma, tenantId)).timezone);
        return zones.get(tenantId)!;
    };

    // 1. Lapsed holds (the cap already ignores them; this tidies the status).
    const holds = await prisma.ridePass.updateMany({
        where: { status: 'HELD', paidAt: null, holdExpiresAt: { lte: now } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'hold_expired' },
    });
    out.cancelledHolds = holds.count;

    // 2. Unpaid PAYG rides give their seat back.
    const pending = await prisma.ride.findMany({
        where: { status: 'PENDING_PAYMENT', paidAt: null, paymentExpiresAt: { lte: now } },
        select: { id: true, tenantId: true, paygDay: true },
        take: BATCH,
    });
    for (const r of pending) {
        try {
            const done = await prisma.$transaction(async (tx) => {
                const claim = await tx.ride.updateMany({
                    where: { id: r.id, tenantId: r.tenantId, status: 'PENDING_PAYMENT', paidAt: null },
                    data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'payment_timeout', paymentExpiresAt: null },
                });
                if (claim.count === 1 && r.paygDay) await releasePaygSlot(tx, r.tenantId, r.paygDay);
                return claim.count === 1;
            });
            if (done) out.expiredPayg++;
        } catch (err) {
            log.error({ err, rideId: r.id }, 'PAYG expiry failed for one ride');
        }
    }

    // 3. Expired packages: unused rides expire with them. A ride in progress finishes first.
    const expiring = await prisma.ridePass.findMany({
        where: { status: 'ACTIVE', expiresAt: { lte: now }, rides: { none: { status: { in: OPEN_STATUSES } } } },
        select: { id: true, tenantId: true, customerId: true },
        take: BATCH,
    });
    for (const p of expiring) {
        try {
            const done = await prisma.$transaction(async (tx) => {
                // A ride booked between the query above and now (booking takes the same
                // customer lock) must finish first: expiring under it would let its
                // completion deduct below zero.
                await lockCustomer(tx, p.customerId);
                const open = await tx.ride.count({ where: { tenantId: p.tenantId, passId: p.id, status: { in: OPEN_STATUSES } } });
                if (open > 0) return false;
                const claim = await tx.ridePass.updateMany({ where: { id: p.id, tenantId: p.tenantId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
                if (claim.count !== 1) return false;
                const { remaining } = await passBalance(tx, p.tenantId, p.id);
                if (remaining > 0) {
                    await tx.ridePassEntry.create({ data: { tenantId: p.tenantId, passId: p.id, type: 'EXPIRY', delta: -remaining, note: 'Package expired' } });
                }
                return true;
            });
            if (done) out.expiredPasses++;
        } catch (err) {
            log.error({ err, passId: p.id }, 'Package expiry failed for one pass');
        }
    }

    // 4a. "Expires soon", once.
    const soon = await prisma.ridePass.findMany({
        where: { status: 'ACTIVE', expiryReminderSentAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRY_REMINDER_DAYS_BEFORE * DAY_MS) } },
        select: { id: true, tenantId: true, customerId: true, conversationId: true, expiresAt: true },
        take: BATCH,
    });
    for (const p of soon) {
        const claim = await prisma.ridePass.updateMany({ where: { id: p.id, tenantId: p.tenantId, expiryReminderSentAt: null }, data: { expiryReminderSentAt: now } });
        if (claim.count !== 1) continue;
        const { remaining } = await passBalance(prisma, p.tenantId, p.id);
        if (remaining <= 0) continue;
        await notifyRideCustomer({ prisma, log }, {
            tenantId: p.tenantId, customerId: p.customerId, conversationId: p.conversationId, kind: 'ride_pass.expiry_reminder',
            text: expiryReminderText({ expiresAt: p.expiresAt!, remaining, timeZone: await zone(p.tenantId) }), emailSubject: 'Your TURBO package expires soon',
        });
        out.expiryReminders++;
    }

    // 4b. "5 rides left", once.
    const active = await prisma.ridePass.findMany({
        where: { status: 'ACTIVE', lowBalanceReminderSentAt: null },
        select: { id: true, tenantId: true, customerId: true, conversationId: true, expiresAt: true },
        take: 500,
    });
    const byTenant = new Map<string, typeof active>();
    for (const p of active) byTenant.set(p.tenantId, [...(byTenant.get(p.tenantId) ?? []), p]);
    for (const [tenantId, passes] of byTenant) {
        const balances = await passBalances(prisma, tenantId, passes.map((p) => p.id));
        for (const p of passes) {
            const remaining = balances.get(p.id)?.remaining ?? 0;
            if (remaining <= 0 || remaining > LOW_BALANCE_AT) continue;
            const claim = await prisma.ridePass.updateMany({ where: { id: p.id, tenantId, lowBalanceReminderSentAt: null }, data: { lowBalanceReminderSentAt: now } });
            if (claim.count !== 1) continue;
            await notifyRideCustomer({ prisma, log }, {
                tenantId, customerId: p.customerId, conversationId: p.conversationId, kind: 'ride_pass.low_balance',
                text: lowBalanceText({ remaining, expiresAt: p.expiresAt, timeZone: await zone(tenantId) }), emailSubject: 'Your TURBO rides are running low',
            });
            out.lowBalanceReminders++;
        }
    }

    const total = Object.values(out).reduce((a, b) => a + b, 0);
    if (total > 0) log.info({ ...out }, 'Rides sweep');
    return out;
}

export function startRideSweeper(prisma: RidesClient, log: RidesLogger): () => void {
    let running = false;
    const timer = setInterval(() => {
        if (running) return;
        running = true;
        sweepRides(prisma, log)
            .catch((err) => log.error({ err }, 'Rides sweep failed'))
            .finally(() => { running = false; });
    }, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
