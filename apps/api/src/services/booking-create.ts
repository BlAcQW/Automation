/**
 * The one way a booking row gets created, and the one list of things that
 * happen once a booking is confirmed.
 *
 * Before this, the dashboard route, the menu bot and the AI assistant each
 * inserted bookings their own way: only one of them re-checked the slot
 * inside a transaction, only one scheduled the reminder, and the assistant
 * did neither. Every caller now goes through here.
 */

import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { Prisma, TemplatePurpose } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { generatePublicToken } from '../lib/public-token.js';
import { scheduleNotification, scheduleReminder } from './notification.js';
import { syncBookingToCalendar } from './calendar.js';
import { createNotification } from './notifications.js';
import { safeZone, zonedDateString, zonedTimeString } from './timezone.js';

export class SlotTakenError extends Error {
    constructor(public readonly conflictingBookingId: string) {
        super('That time is no longer available');
        this.name = 'SlotTakenError';
    }
}

export interface CreateBookingArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    serviceId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    startTime: Date;
    endTime: Date;
    /** Major units. 0 means no deposit: the booking is confirmed immediately. */
    depositAmount: number;
    notes?: string | null;
}

export interface CreatedBooking {
    id: string;
    bookingReference: string;
    status: 'PENDING_PAYMENT' | 'CONFIRMED';
    startTime: Date;
    endTime: Date;
    customerName: string;
    customerPhone: string;
    depositAmount: Prisma.Decimal | null;
}

// No 0/O/1/I: the reference is read out over the phone and typed by hand.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateBookingReference(random: () => number = Math.random): string {
    let ref = 'BK-';
    for (let i = 0; i < 6; i += 1) {
        ref += REF_ALPHABET.charAt(Math.floor(random() * REF_ALPHABET.length));
    }
    return ref;
}

/**
 * Insert the booking, re-checking the slot inside a serializable transaction
 * so two customers who were both shown "14:00 is free" cannot both get it.
 * Held (`PENDING_PAYMENT`) bookings count as taken.
 */
export async function createBookingAtomic(args: CreateBookingArgs): Promise<CreatedBooking> {
    const { prisma, tenantId, startTime, endTime } = args;
    const held = args.depositAmount > 0;

    // The reference is globally unique; a collision is astronomically rare
    // but cheap to survive.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                const overlap = await tx.booking.findFirst({
                    where: {
                        tenantId,
                        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
                        startTime: { lt: endTime },
                        endTime: { gt: startTime },
                    },
                    select: { id: true },
                });
                if (overlap) throw new SlotTakenError(overlap.id);

                return tx.booking.create({
                    data: {
                        tenantId,
                        serviceId: args.serviceId,
                        customerName: args.customerName,
                        customerPhone: args.customerPhone,
                        customerEmail: args.customerEmail ?? null,
                        startTime,
                        endTime,
                        status: held ? 'PENDING_PAYMENT' : 'CONFIRMED',
                        bookingReference: generateBookingReference(),
                        publicToken: generatePublicToken(),
                        depositAmount: held ? new Prisma.Decimal(args.depositAmount) : null,
                        notes: args.notes ?? null,
                    },
                    select: {
                        id: true,
                        bookingReference: true,
                        status: true,
                        startTime: true,
                        endTime: true,
                        customerName: true,
                        customerPhone: true,
                        depositAmount: true,
                    },
                });
            }, { isolationLevel: 'Serializable' }) as CreatedBooking;
        } catch (err) {
            const unique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
            if (!unique || attempt === 2) throw err;
        }
    }
    throw new Error('unreachable');
}

export interface ConfirmedSideEffectsArgs {
    prisma: ExtendedPrismaClient;
    queues: { notifications: Queue | null; reminders: Queue | null } | null | undefined;
    log?: FastifyBaseLogger;
    tenantId: string;
    timezone: string | null | undefined;
    booking: Pick<CreatedBooking, 'id' | 'bookingReference' | 'startTime' | 'customerName' | 'customerPhone'>;
    service: { name: string };
}

/**
 * Everything that should happen once a booking is CONFIRMED: confirmation
 * template, reminder an hour before, calendar sync, in-app notification.
 * Dates are rendered in the business's timezone, not the server's.
 */
export async function afterBookingConfirmed(args: ConfirmedSideEffectsArgs): Promise<void> {
    const { prisma, booking, service, tenantId } = args;
    const zone = safeZone(args.timezone);
    const dateStr = zonedDateString(booking.startTime, zone);
    const timeStr = zonedTimeString(booking.startTime, zone);
    const notificationsQueue = args.queues?.notifications ?? null;
    const remindersQueue = args.queues?.reminders ?? null;

    await scheduleNotification({
        queue: notificationsQueue,
        purpose: TemplatePurpose.BOOKING_CONFIRMATION,
        tenantId,
        customerPhone: booking.customerPhone,
        variables: [booking.customerName, service.name, dateStr, timeStr, booking.bookingReference],
        jobId: `booking_confirmation_${booking.id}`,
    }).catch((err) => args.log?.warn({ err, bookingId: booking.id }, 'Confirmation template not queued'));

    await scheduleReminder({
        queue: remindersQueue,
        tenantId,
        bookingId: booking.id,
        customerPhone: booking.customerPhone,
        variables: [service.name, timeStr],
        sendAt: new Date(booking.startTime.getTime() - 60 * 60 * 1000),
    }).catch((err) => args.log?.warn({ err, bookingId: booking.id }, 'Reminder not queued'));

    await syncBookingToCalendar({ bookingId: booking.id, tenantId, prisma })
        .catch((err) => args.log?.warn({ err, bookingId: booking.id }, 'Calendar sync failed'));

    await createNotification(prisma, {
        tenantId,
        type: 'NEW_BOOKING',
        title: 'New booking',
        message: `${booking.customerName} booked ${service.name} for ${dateStr} at ${timeStr}`,
        metadata: { bookingId: booking.id, bookingReference: booking.bookingReference },
    }, args.log).catch((err) => args.log?.warn({ err, bookingId: booking.id }, 'In-app notification failed'));
}
