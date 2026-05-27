/**
 * Notification Service
 *
 * Schedules WhatsApp template messages via BullMQ. All proactive sends use
 * approved Meta templates; this module is the producer.
 */

import { Queue } from 'bullmq';
import { TemplatePurpose } from '@prisma/client';
import { NotificationJob, ReminderJob } from '../plugins/redis.js';

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
        console.warn('Notification queue not available - notification not scheduled');
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

export interface ScheduleReminderOptions {
    queue: Queue | null;
    purpose?: TemplatePurpose; // defaults to BOOKING_REMINDER
    tenantId: string;
    bookingId: string;
    customerPhone: string;
    /** Positional template variables — typically [serviceName, time]. */
    variables: string[];
    /** Absolute send time. The job is scheduled with the corresponding delay. */
    sendAt: Date;
}

export async function scheduleReminder(
    options: ScheduleReminderOptions,
): Promise<string | null> {
    if (!options.queue) {
        console.warn('Reminder queue not available - reminder not scheduled');
        return null;
    }

    const delay = options.sendAt.getTime() - Date.now();
    if (delay <= 0) {
        console.warn('Reminder time already passed - not scheduling');
        return null;
    }

    const job: ReminderJob = {
        purpose: options.purpose ?? TemplatePurpose.BOOKING_REMINDER,
        tenantId: options.tenantId,
        bookingId: options.bookingId,
        customerPhone: options.customerPhone,
        variables: options.variables,
    };

    const jobId = `reminder-${options.bookingId}`;

    const added = await options.queue.add('booking_reminder', job, {
        delay,
        jobId,
    });

    return added.id ?? null;
}

/**
 * Cancel a scheduled reminder by bookingId. The jobId scheme is stable per
 * booking (`reminder-<bookingId>`), so we no longer have to know the
 * reminder lead-time.
 */
export async function cancelReminder(queue: Queue | null, bookingId: string): Promise<boolean> {
    if (!queue) return false;

    const jobId = `reminder-${bookingId}`;
    const job = await queue.getJob(jobId);
    if (job) {
        await job.remove();
        return true;
    }
    return false;
}
