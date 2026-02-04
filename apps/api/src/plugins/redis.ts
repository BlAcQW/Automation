import { Queue } from 'bullmq';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

// Queue names
export const QUEUE_NAMES = {
    NOTIFICATIONS: 'notifications',
    REMINDERS: 'reminders',
    CALENDAR_SYNC: 'calendar-sync',
} as const;

declare module 'fastify' {
    interface FastifyInstance {
        redis: IORedis | null;
        queues: {
            notifications: Queue | null;
            reminders: Queue | null;
            calendarSync: Queue | null;
        };
        hasRedis: boolean;
    }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
    // Check if Redis is configured
    if (!config.redisUrl) {
        fastify.log.warn('Redis URL not configured - job queues disabled');

        // Decorate with null values
        fastify.decorate('redis', null);
        fastify.decorate('queues', {
            notifications: null,
            reminders: null,
            calendarSync: null,
        });
        fastify.decorate('hasRedis', false);
        return;
    }

    // Create Redis connection
    const redis = new IORedis(config.redisUrl, {
        maxRetriesPerRequest: null, // Required for BullMQ
    });

    // Create queues
    const notificationsQueue = new Queue(QUEUE_NAMES.NOTIFICATIONS, {
        connection: redis,
        defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 1000,
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 60000, // 1 minute
            },
        },
    });

    const remindersQueue = new Queue(QUEUE_NAMES.REMINDERS, {
        connection: redis,
        defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 1000,
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 60000,
            },
        },
    });

    const calendarSyncQueue = new Queue(QUEUE_NAMES.CALENDAR_SYNC, {
        connection: redis,
        defaultJobOptions: {
            removeOnComplete: 50,
            removeOnFail: 500,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 30000,
            },
        },
    });

    // Decorate fastify with redis and queues
    fastify.decorate('redis', redis);
    fastify.decorate('queues', {
        notifications: notificationsQueue,
        reminders: remindersQueue,
        calendarSync: calendarSyncQueue,
    });
    fastify.decorate('hasRedis', true);

    // Cleanup on close
    fastify.addHook('onClose', async () => {
        await notificationsQueue.close();
        await remindersQueue.close();
        await calendarSyncQueue.close();
        await redis.quit();
    });
};

export default fp(redisPlugin, {
    name: 'redis',
});

// Job type definitions
export interface NotificationJob {
    type: 'booking_confirmation' | 'booking_reminder' | 'booking_cancellation';
    tenantId: string;
    bookingId: string;
    customerPhone: string;
}

export interface ReminderJob {
    tenantId: string;
    bookingId: string;
    customerPhone: string;
    serviceName: string;
    startTime: string;
}

export interface CalendarSyncJob {
    tenantId: string;
    calendarIntegrationId: string;
}
