/**
 * Notification Service
 * 
 * Handles scheduling and sending notifications via WhatsApp.
 * Uses BullMQ for reliable job processing with retries.
 */

import { Queue } from 'bullmq';
import { NotificationJob, ReminderJob, QUEUE_NAMES } from '../plugins/redis.js';

// Types
export type NotificationType =
    | 'booking_confirmation'
    | 'booking_reminder'
    | 'booking_cancellation'
    | 'order_confirmation'
    | 'order_shipped'
    | 'order_delivered';

export interface ScheduleNotificationOptions {
    tenantId: string;
    type: NotificationType;
    customerPhone: string;
    data: Record<string, any>;
    delay?: number; // ms delay before sending
}

export interface ScheduleReminderOptions {
    tenantId: string;
    bookingId: string;
    customerPhone: string;
    serviceName: string;
    startTime: Date;
    reminderMinutes?: number; // minutes before appointment (default: 60)
}

/**
 * Schedule a notification to be sent
 */
export async function scheduleNotification(
    queue: Queue | null,
    options: ScheduleNotificationOptions
): Promise<string | null> {
    if (!queue) {
        console.warn('Notification queue not available - notification not scheduled');
        return null;
    }

    const jobId = `${options.type}-${options.tenantId}-${Date.now()}`;

    const job = await queue.add(
        options.type,
        {
            type: options.type,
            tenantId: options.tenantId,
            customerPhone: options.customerPhone,
            ...options.data,
        },
        {
            delay: options.delay || 0,
            jobId,
        }
    );

    return job.id || null;
}

/**
 * Schedule a booking reminder
 */
export async function scheduleReminder(
    queue: Queue | null,
    options: ScheduleReminderOptions
): Promise<string | null> {
    if (!queue) {
        console.warn('Reminder queue not available - reminder not scheduled');
        return null;
    }

    const reminderMinutes = options.reminderMinutes ?? 60;
    const reminderTime = new Date(options.startTime.getTime() - reminderMinutes * 60 * 1000);
    const delay = reminderTime.getTime() - Date.now();

    // Don't schedule if reminder time already passed
    if (delay <= 0) {
        console.warn('Reminder time already passed - not scheduling');
        return null;
    }

    const jobId = `reminder-${options.bookingId}-${reminderMinutes}min`;

    const job = await queue.add(
        'booking_reminder',
        {
            tenantId: options.tenantId,
            bookingId: options.bookingId,
            customerPhone: options.customerPhone,
            serviceName: options.serviceName,
            startTime: options.startTime.toISOString(),
        } as ReminderJob,
        {
            delay,
            jobId,
        }
    );

    return job.id || null;
}

/**
 * Cancel a scheduled reminder by booking ID
 */
export async function cancelReminder(
    queue: Queue | null,
    bookingId: string
): Promise<boolean> {
    if (!queue) return false;

    const jobId = `reminder-${bookingId}-60min`;
    const job = await queue.getJob(jobId);

    if (job) {
        await job.remove();
        return true;
    }

    return false;
}

/**
 * Schedule booking confirmation notification
 */
export async function scheduleBookingConfirmation(
    queue: Queue | null,
    tenantId: string,
    booking: {
        id: string;
        customerPhone: string;
        customerName: string;
        serviceName: string;
        startTime: Date;
        bookingReference: string;
    }
): Promise<string | null> {
    return scheduleNotification(queue, {
        tenantId,
        type: 'booking_confirmation',
        customerPhone: booking.customerPhone,
        data: {
            bookingId: booking.id,
            customerName: booking.customerName,
            serviceName: booking.serviceName,
            startTime: booking.startTime.toISOString(),
            bookingReference: booking.bookingReference,
        },
    });
}

/**
 * Schedule order confirmation notification
 */
export async function scheduleOrderConfirmation(
    queue: Queue | null,
    tenantId: string,
    order: {
        id: string;
        orderNumber: string;
        customerPhone: string;
        customerName: string;
        totalAmount: number;
    }
): Promise<string | null> {
    return scheduleNotification(queue, {
        tenantId,
        type: 'order_confirmation',
        customerPhone: order.customerPhone,
        data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            totalAmount: order.totalAmount,
        },
    });
}

/**
 * Schedule order status update notification
 */
export async function scheduleOrderStatusUpdate(
    queue: Queue | null,
    tenantId: string,
    order: {
        id: string;
        orderNumber: string;
        customerPhone: string;
        status: 'shipped' | 'delivered';
    }
): Promise<string | null> {
    const type = order.status === 'shipped' ? 'order_shipped' : 'order_delivered';

    return scheduleNotification(queue, {
        tenantId,
        type,
        customerPhone: order.customerPhone,
        data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
        },
    });
}

/**
 * Get message template for notification type
 */
export function getNotificationMessage(type: NotificationType, data: Record<string, any>): string {
    const templates: Record<NotificationType, (data: Record<string, any>) => string> = {
        booking_confirmation: (d) =>
            `✅ Booking Confirmed!\n\n` +
            `📋 ${d.serviceName}\n` +
            `📅 ${new Date(d.startTime).toLocaleDateString()}\n` +
            `⏰ ${new Date(d.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n` +
            `🔖 Ref: ${d.bookingReference}\n\n` +
            `We'll send you a reminder 1 hour before your appointment.`,

        booking_reminder: (d) =>
            `⏰ Reminder: Your appointment is in 1 hour!\n\n` +
            `📋 ${d.serviceName}\n` +
            `⏰ ${new Date(d.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\n` +
            `See you soon!`,

        booking_cancellation: (d) =>
            `❌ Booking Cancelled\n\n` +
            `Your booking for ${d.serviceName} on ${new Date(d.startTime).toLocaleDateString()} has been cancelled.\n\n` +
            `If you didn't request this, please contact us.`,

        order_confirmation: (d) =>
            `✅ Order Confirmed!\n\n` +
            `📦 Order #${d.orderNumber}\n` +
            `💰 Total: $${d.totalAmount}\n\n` +
            `We'll notify you when your order ships.`,

        order_shipped: (d) =>
            `🚚 Your order is on its way!\n\n` +
            `📦 Order #${d.orderNumber}\n\n` +
            `Track your delivery for updates.`,

        order_delivered: (d) =>
            `📬 Order Delivered!\n\n` +
            `📦 Order #${d.orderNumber}\n\n` +
            `Thank you for your order!`,
    };

    return templates[type](data);
}
