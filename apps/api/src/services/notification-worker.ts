/**
 * Notification Worker
 * 
 * Processes notification and reminder jobs from BullMQ queues.
 * Sends WhatsApp messages for various notification types.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { QUEUE_NAMES, NotificationJob, ReminderJob } from '../plugins/redis.js';
import { getNotificationMessage, NotificationType } from './notification.js';
import { config } from '../config/index.js';

const prisma = new PrismaClient();

/**
 * Send WhatsApp message
 */
async function sendWhatsAppMessage(
    accessToken: string,
    phoneNumberId: string,
    to: string,
    message: string
): Promise<boolean> {
    try {
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to,
                    type: 'text',
                    text: { body: message },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error('WhatsApp API error:', error);
            return false;
        }

        return true;
    } catch (err) {
        console.error('Failed to send WhatsApp message:', err);
        return false;
    }
}

/**
 * Process notification job
 */
async function processNotification(job: Job<NotificationJob>): Promise<void> {
    const { type, tenantId, customerPhone, ...data } = job.data;

    console.log(`Processing notification: ${type} for ${customerPhone}`);

    // Get tenant's WhatsApp credentials
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            whatsappAccessToken: true,
            whatsappPhoneNumberId: true,
        },
    });

    if (!tenant?.whatsappAccessToken || !tenant?.whatsappPhoneNumberId) {
        throw new Error('Tenant WhatsApp credentials not configured');
    }

    // Generate message
    const message = getNotificationMessage(type as NotificationType, data);

    // Send message
    const success = await sendWhatsAppMessage(
        tenant.whatsappAccessToken,
        tenant.whatsappPhoneNumberId,
        customerPhone,
        message
    );

    if (!success) {
        throw new Error('Failed to send WhatsApp message');
    }

    console.log(`Notification sent successfully: ${type} to ${customerPhone}`);
}

/**
 * Process reminder job
 */
async function processReminder(job: Job<ReminderJob>): Promise<void> {
    const { tenantId, bookingId, customerPhone, serviceName, startTime } = job.data;

    console.log(`Processing reminder for booking ${bookingId}`);

    // Verify booking still exists and is confirmed
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
    });

    if (!booking || booking.status !== 'CONFIRMED') {
        console.log('Booking no longer active, skipping reminder');
        return;
    }

    // Get tenant's WhatsApp credentials
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            whatsappAccessToken: true,
            whatsappPhoneNumberId: true,
        },
    });

    if (!tenant?.whatsappAccessToken || !tenant?.whatsappPhoneNumberId) {
        throw new Error('Tenant WhatsApp credentials not configured');
    }

    // Generate message
    const message = getNotificationMessage('booking_reminder', {
        serviceName,
        startTime,
    });

    // Send message
    const success = await sendWhatsAppMessage(
        tenant.whatsappAccessToken,
        tenant.whatsappPhoneNumberId,
        customerPhone,
        message
    );

    if (!success) {
        throw new Error('Failed to send reminder');
    }

    console.log(`Reminder sent for booking ${bookingId}`);
}

/**
 * Start notification workers
 */
export function startNotificationWorkers(redisUrl: string | undefined): {
    notifications: Worker | null;
    reminders: Worker | null;
} {
    if (!redisUrl) {
        console.warn('Redis not configured - notification workers disabled');
        return { notifications: null, reminders: null };
    }

    const connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
    });

    // Notifications worker
    const notificationsWorker = new Worker(
        QUEUE_NAMES.NOTIFICATIONS,
        async (job) => processNotification(job),
        {
            connection,
            concurrency: 5,
        }
    );

    notificationsWorker.on('completed', (job) => {
        console.log(`Notification job ${job.id} completed`);
    });

    notificationsWorker.on('failed', (job, err) => {
        console.error(`Notification job ${job?.id} failed:`, err.message);
    });

    // Reminders worker
    const remindersWorker = new Worker(
        QUEUE_NAMES.REMINDERS,
        async (job) => processReminder(job),
        {
            connection,
            concurrency: 5,
        }
    );

    remindersWorker.on('completed', (job) => {
        console.log(`Reminder job ${job.id} completed`);
    });

    remindersWorker.on('failed', (job, err) => {
        console.error(`Reminder job ${job?.id} failed:`, err.message);
    });

    console.log('Notification workers started');

    return {
        notifications: notificationsWorker,
        reminders: remindersWorker,
    };
}

/**
 * Stop notification workers
 */
export async function stopNotificationWorkers(workers: {
    notifications: Worker | null;
    reminders: Worker | null;
}): Promise<void> {
    if (workers.notifications) {
        await workers.notifications.close();
    }
    if (workers.reminders) {
        await workers.reminders.close();
    }
    console.log('Notification workers stopped');
}
