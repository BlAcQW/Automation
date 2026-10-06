/**
 * PAYG daily capacity. One PaygDay row per tenant per local day.
 *
 * Reserving is a single conditional UPDATE (used < limit): Postgres re-checks
 * the WHERE on the latest row version after taking the row lock, so N callers
 * racing for the last slot get exactly one success. Releasing never goes below
 * zero. Both take a transaction client so the slot and the ride that holds it
 * commit (or roll back) together.
 */
import type { RidesDb } from './db.js';
import { zonedDateString } from '../timezone.js';

export function paygDayKey(now: Date, timezone: string): string {
    return zonedDateString(now, timezone);
}

export async function reservePaygSlot(db: RidesDb, tenantId: string, day: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    await db.paygDay.upsert({
        where: { tenantId_day: { tenantId, day } },
        create: { tenantId, day, used: 0 },
        // Non-empty on purpose: an empty update makes Prisma read-then-insert, and two first reservations race (P2002).
        update: { used: { increment: 0 } },
    });
    const claimed = await db.paygDay.updateMany({
        where: { tenantId, day, used: { lt: limit } },
        data: { used: { increment: 1 } },
    });
    return claimed.count === 1;
}

export async function releasePaygSlot(db: RidesDb, tenantId: string, day: string): Promise<void> {
    await db.paygDay.updateMany({ where: { tenantId, day, used: { gt: 0 } }, data: { used: { decrement: 1 } } });
}

export async function paygUsed(db: RidesDb, tenantId: string, day: string): Promise<number> {
    const row = await db.paygDay.findFirst({ where: { tenantId, day }, select: { used: true } });
    return row?.used ?? 0;
}
