import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const customersRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /customers - List aggregated customers
    fastify.get('/', async (request) => {
        const { tenantId } = request.user;
        const query = z.object({
            search: z.string().optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
        }).parse(request.query);

        const skip = (query.page - 1) * query.limit;

        // 1. Get base conversations (represents customers)
        // If searching, filter by name/phone
        const where: any = { tenantId };
        if (query.search) {
            where.OR = [
                { customerName: { contains: query.search, mode: 'insensitive' } },
                { customerPhone: { contains: query.search } },
            ];
        }

        const [conversations, total] = await Promise.all([
            fastify.prisma.conversation.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { updatedAt: 'desc' },
                select: {
                    customerPhone: true,
                    customerName: true,
                    updatedAt: true, // Last active
                },
            }),
            fastify.prisma.conversation.count({ where }),
        ]);

        if (conversations.length === 0) {
            return {
                data: [],
                pagination: {
                    page: query.page,
                    limit: query.limit,
                    total,
                    totalPages: 0,
                },
            };
        }

        // 2. Get stats for these specific phones
        const phones = conversations.map(c => c.customerPhone);

        const [orderCounts, bookingCounts] = await Promise.all([
            fastify.prisma.order.groupBy({
                by: ['customerPhone'],
                where: {
                    tenantId,
                    customerPhone: { in: phones },
                },
                _count: true,
                _sum: { totalAmount: true },
            }),
            fastify.prisma.booking.groupBy({
                by: ['customerPhone'],
                where: {
                    tenantId,
                    customerPhone: { in: phones },
                },
                _count: true,
            }),
        ]);

        // 3. Merge data
        const customers = conversations.map(c => {
            const orders = orderCounts.find(o => o.customerPhone === c.customerPhone);
            const bookings = bookingCounts.find(b => b.customerPhone === c.customerPhone);

            return {
                id: c.customerPhone, // Use phone as ID for frontend
                name: c.customerName || 'Unknown',
                phone: c.customerPhone,
                lastActive: c.updatedAt,
                totalOrders: orders?._count || 0,
                totalSpent: Number(orders?._sum.totalAmount || 0),
                totalBookings: bookings?._count || 0,
            };
        });

        return {
            data: customers,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /customers/stats
    fastify.get('/stats', async (request) => {
        const { tenantId } = request.user;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [totalCustomers, activeThisMonth, totalOrders] = await Promise.all([
            fastify.prisma.conversation.count({ where: { tenantId } }),
            fastify.prisma.conversation.count({
                where: {
                    tenantId,
                    updatedAt: { gte: startOfMonth },
                },
            }),
            fastify.prisma.order.count({ where: { tenantId } }),
        ]);

        return {
            totalCustomers,
            activeThisMonth,
            totalOrders,
        };
    });
};

export default customersRoutes;
