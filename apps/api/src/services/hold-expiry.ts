/**
 * Release slots whose deposit was never paid.
 *
 * A booking waiting on its deposit is `PENDING_PAYMENT` and blocks the slot
 * for everyone else. Without this sweep a customer who asked for a link and
 * walked away would hold 14:00 forever. Runs in-process on a timer: no Redis
 * needed, and a minute of drift is fine for a 30-minute hold.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { HOLD_MINUTES } from './booking-deposit.js';
import { createNotification } from './notifications.js';
import { publish } from './realtime.js';

const SWEEP_EVERY_MS = 60_000;

export async function releaseExpiredHolds(
    prisma: ExtendedPrismaClient,
    log?: FastifyBaseLogger,
    now: Date = new Date(),
): Promise<number> {
    const cutoff = new Date(now.getTime() - HOLD_MINUTES * 60_000);

    const expired = await prisma.booking.findMany({
        where: { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', createdAt: { lt: cutoff } },
        select: { id: true, tenantId: true, bookingReference: true, customerName: true, notes: true },
    });
    if (expired.length === 0) return 0;

    // Only flip rows that are still unpaid: a payment webhook landing in the
    // same second wins, and the customer keeps their slot.
    for (const b of expired) {
        const released = await prisma.booking.updateMany({
            where: { id: b.id, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' },
            data: {
                status: 'CANCELLED',
                notes: [b.notes, `Released: deposit not paid within ${HOLD_MINUTES} minutes.`].filter(Boolean).join('\n'),
            },
        });
        if (released.count === 0) continue;

        await createNotification(prisma, {
            tenantId: b.tenantId,
            type: 'BOOKING_CANCELLED',
            title: 'Hold released',
            message: `${b.customerName}'s booking ${b.bookingReference} was released: the deposit was not paid in ${HOLD_MINUTES} minutes.`,
            metadata: { bookingId: b.id, reason: 'deposit_timeout' },
        }, log).catch(() => undefined);
        publish(b.tenantId, { type: 'booking' });
    }

    log?.info({ released: expired.length }, 'Released expired booking holds');
    return expired.length;
}

export function startHoldExpirySweeper(prisma: ExtendedPrismaClient, log: FastifyBaseLogger): () => void {
    const timer = setInterval(() => {
        releaseExpiredHolds(prisma, log).catch((err) => log.error({ err }, 'Hold expiry sweep failed'));
    }, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
