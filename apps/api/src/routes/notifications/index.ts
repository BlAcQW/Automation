import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /notifications - List notifications (newest first)
    fastify.get('/', async (request) => {
        const query = z.object({
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(50).default(15),
            unreadOnly: z.enum(['true', 'false']).default('false'),
        }).parse(request.query);

        const where: any = { tenantId: request.user.tenantId };
        if (query.unreadOnly === 'true') where.isRead = false;

        const skip = (query.page - 1) * query.limit;

        const [notifications, total] = await Promise.all([
            fastify.prisma.notification.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
            }),
            fastify.prisma.notification.count({ where }),
        ]);

        return {
            data: notifications,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /notifications/unread-count - Get unread notification count
    fastify.get('/unread-count', async (request) => {
        const count = await fastify.prisma.notification.count({
            where: {
                tenantId: request.user.tenantId,
                isRead: false,
            },
        });

        return { count };
    });

    // PATCH /notifications/:id/read - Mark a single notification as read
    fastify.patch('/:id/read', async (request) => {
        const { id } = request.params as { id: string };

        const notification = await fastify.prisma.notification.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!notification) {
            throw fastify.httpErrors.notFound('Notification not found');
        }

        const updated = await fastify.prisma.notification.update({
            where: { id },
            data: { isRead: true },
        });

        return updated;
    });

    // POST /notifications/mark-all-read - Mark all notifications as read
    fastify.post('/mark-all-read', async (request) => {
        const result = await fastify.prisma.notification.updateMany({
            where: {
                tenantId: request.user.tenantId,
                isRead: false,
            },
            data: { isRead: true },
        });

        return { updated: result.count };
    });
};

export default notificationsRoutes;
