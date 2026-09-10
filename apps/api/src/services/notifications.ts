import type { NotificationType, Prisma } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { sendPushToTenant } from './push.js';
import { publish } from './realtime.js';

/**
 * Central helper for creating an owner/staff-facing in-app Notification AND
 * fanning it out as a mobile push. Prefer this over calling
 * `prisma.notification.create` directly so every new notification also reaches
 * the mobile app. Push is best-effort and never blocks the write.
 */

interface CreateNotificationArgs {
    tenantId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: Prisma.InputJsonValue;
}

interface NotificationLogger {
    warn: (obj: unknown, msg?: string) => void;
}

export async function createNotification(
    prisma: ExtendedPrismaClient,
    args: CreateNotificationArgs,
    logger?: NotificationLogger,
): Promise<void> {
    await prisma.notification.create({
        data: {
            tenantId: args.tenantId,
            type: args.type,
            title: args.title,
            message: args.message,
            ...(args.metadata !== undefined && { metadata: args.metadata }),
        },
    });

    // Live nudge to any open app (WebSocket) so it refetches immediately.
    publish(args.tenantId, { type: 'notification' });

    const data: Record<string, unknown> = { type: args.type };
    if (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)) {
        Object.assign(data, args.metadata);
    }

    await sendPushToTenant(
        prisma,
        args.tenantId,
        { title: args.title, body: args.message, data },
        logger,
    );
}
