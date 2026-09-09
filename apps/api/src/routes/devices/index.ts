import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

/**
 * Device push-token registration for the mobile app. Tokens are Expo push
 * tokens; they are upserted per device (unique by token) and deleted on logout.
 * Fan-out happens in services/notifications.ts → services/push.ts.
 */
const devicesRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /devices/register - register/refresh this device's push token
    fastify.post('/register', { preHandler: [fastify.authenticate] }, async (request) => {
        const body = z.object({
            token: z.string().min(1),
            platform: z.enum(['ios', 'android']),
        }).parse(request.body);

        // Unique by token: the same physical device re-registers under whoever
        // is currently logged in, so reassign userId/tenantId on conflict.
        await fastify.prisma.deviceToken.upsert({
            where: { token: body.token },
            create: {
                token: body.token,
                platform: body.platform,
                userId: request.user.userId,
                tenantId: request.user.tenantId,
            },
            update: {
                userId: request.user.userId,
                tenantId: request.user.tenantId,
                platform: body.platform,
                lastSeenAt: new Date(),
            },
        });

        return { success: true };
    });

    // DELETE /devices/:token - unregister on logout (scoped to the caller)
    fastify.delete('/:token', { preHandler: [fastify.authenticate] }, async (request) => {
        const { token } = request.params as { token: string };

        await fastify.prisma.deviceToken.deleteMany({
            where: { token, userId: request.user.userId },
        });

        return { success: true };
    });
};

export default devicesRoutes;
