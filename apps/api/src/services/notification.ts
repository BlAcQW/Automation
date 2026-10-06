/**
 * Notification Service
 *
 * Schedules WhatsApp template messages via BullMQ. All proactive sends use
 * approved Meta templates; this module is the producer.
 */

import { Queue } from 'bullmq';
import { TemplatePurpose } from '@prisma/client';
import type { NotificationJob } from '../plugins/redis.js';
import { scoped } from '../lib/logger.js';

const log = scoped('notification');

export interface ScheduleNotificationOptions {
    queue: Queue | null;
    purpose: TemplatePurpose;
    tenantId: string;
    customerPhone: string;
    variables: string[];
    /** ms delay before sending */
    delay?: number;
    /** stable id for deduplication (e.g. `booking_confirmation_<bookingId>`) */
    jobId?: string;
}

export async function scheduleNotification(
    options: ScheduleNotificationOptions,
): Promise<string | null> {
    if (!options.queue) {
        log.warn('Notification queue not available - notification not scheduled');
        return null;
    }

    const job: NotificationJob = {
        purpose: options.purpose,
        tenantId: options.tenantId,
        customerPhone: options.customerPhone,
        variables: options.variables,
    };

    const jobId = options.jobId ?? `${options.purpose}-${options.tenantId}-${Date.now()}`;

    const added = await options.queue.add(options.purpose, job, {
        delay: options.delay ?? 0,
        jobId,
    });

    return added.id ?? null;
}

/**
 * What a queued reminder carries. Reminders are about an entity (a booking
 * today; a pack's own records tomorrow), not about bookings specifically.
 *
 * Jobs queued before this change carry only `bookingId`, and a booking job
 * still carries it so a worker that predates this change can read it during a
 * rolling deploy. `normalizeReminderJob` (notification-purposes.ts) turns
 * either shape into the generic one.
 */
export interface ReminderJobPayload {
    purpose: TemplatePurpose;
    tenantId: string;
    /** Registry key, e.g. 'booking'. Absent only on legacy booking jobs. */
    entityType?: string;
    entityId?: string;
    /** Legacy field: set on booking reminders, and the only id on old jobs. */
    bookingId?: string;
    customerId?: string | null;
    customerPhone: string;
    variables: string[];
}

interface ScheduleReminderBase {
    queue: Queue | null;
    tenantId: string;
    customerPhone: string;
    customerId?: string | null;
    /** Positional template variables, e.g. [serviceName, time]. */
    variables: string[];
    /** Absolute send time. The job is scheduled with the corresponding delay. */
    sendAt: Date;
}

export type ScheduleReminderOptions = ScheduleReminderBase &
    (
        | {
              /** Booking reminder (the original form). purpose defaults to BOOKING_REMINDER. */
              bookingId: string;
              purpose?: TemplatePurpose;
              entityType?: undefined;
              entityId?: undefined;
          }
        | {
              entityType: string;
              entityId: string;
              purpose: TemplatePurpose;
              bookingId?: undefined;
          }
    );

const ENTITY_TYPE_RE = /^[a-z][a-z0-9_]*$/;

/** Stable per entity so a reminder can be replaced or cancelled without its lead time. */
export function reminderJobId(entityType: string, entityId: string): string {
    return entityType === 'booking' ? `reminder-${entityId}` : `reminder-${entityType}-${entityId}`;
}

export async function scheduleReminder(
    options: ScheduleReminderOptions,
): Promise<string | null> {
    if (!options.queue) {
        log.warn('Reminder queue not available - reminder not scheduled');
        return null;
    }

    const entityType = options.entityType ?? 'booking';
    const entityId = options.entityId ?? options.bookingId;
    if (!ENTITY_TYPE_RE.test(entityType) || !entityId) {
        throw new Error('scheduleReminder: a valid entityType and entityId are required');
    }

    const delay = options.sendAt.getTime() - Date.now();
    if (delay <= 0) {
        log.warn('Reminder time already passed - not scheduling');
        return null;
    }

    const job: ReminderJobPayload = {
        purpose: options.purpose ?? TemplatePurpose.BOOKING_REMINDER,
        tenantId: options.tenantId,
        entityType,
        entityId,
        ...(entityType === 'booking' ? { bookingId: entityId } : {}),
        ...(options.customerId ? { customerId: options.customerId } : {}),
        customerPhone: options.customerPhone,
        variables: options.variables,
    };

    const added = await options.queue.add(`${entityType}_reminder`, job, {
        delay,
        jobId: reminderJobId(entityType, entityId),
    });

    return added.id ?? null;
}

/** Cancel a scheduled reminder for any entity. Returns whether one was removed. */
export async function cancelEntityReminder(
    queue: Queue | null,
    entityType: string,
    entityId: string,
): Promise<boolean> {
    if (!queue) return false;

    const job = await queue.getJob(reminderJobId(entityType, entityId));
    if (job) {
        await job.remove();
        return true;
    }
    return false;
}

/** Cancel a booking's reminder. The jobId is stable per booking (`reminder-<bookingId>`). */
export async function cancelReminder(queue: Queue | null, bookingId: string): Promise<boolean> {
    return cancelEntityReminder(queue, 'booking', bookingId);
}
