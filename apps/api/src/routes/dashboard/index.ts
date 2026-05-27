import { FastifyPluginAsync } from 'fastify';

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    fastify.get('/stats', async (request) => {
        const { tenantId } = request.user;
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [totalBookings, todayBookings, activeConversations, totalCustomers] =
            await Promise.all([
                fastify.prisma.booking.count({ where: { tenantId } }),
                fastify.prisma.booking.count({
                    where: { tenantId, startTime: { gte: startOfDay, lt: endOfDay } },
                }),
                // "Active" = inside the WhatsApp 24h CS window — uses
                // @@index([tenantId, lastInboundAt]) on Conversation.
                fastify.prisma.conversation.count({
                    where: { tenantId, lastInboundAt: { gte: twentyFourHoursAgo } },
                }),
                fastify.prisma.conversation.count({ where: { tenantId } }),
            ]);

        return {
            data: { totalBookings, todayBookings, activeConversations, totalCustomers },
        };
    });
};

export default dashboardRoutes;
