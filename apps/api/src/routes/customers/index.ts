import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { maskPhone } from '../../services/contact-privacy.js';
import { resolveMaskPolicy } from '../../services/contact-privacy-policy.js';

/**
 * A stable, non-reversible list key for a masked customer. Two customers whose
 * numbers end in the same four digits must still be distinct rows, so the
 * masked string itself cannot serve as the key.
 */
function phoneKey(phone: string): string {
    return crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16);
}

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
        // Masking is decided before the query, because it also narrows what
        // may be searched.
        const mask = await resolveMaskPolicy(fastify.prisma, tenantId, request.user.role);

        const where: any = { tenantId };
        if (query.search) {
            // Phone search is withheld from masked viewers: being able to ask
            // "which customers contain 0241?" and watch the result count is a
            // digit-at-a-time way back to the number the mask hides.
            where.OR = mask
                ? [{ customerName: { contains: query.search, mode: 'insensitive' } }]
                : [
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
                    id: true, // real conversation id — the reveal endpoint resolves on this
                    customerPhone: true,
                    customerHandle: true,
                    channel: true,
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
        // Instagram and Messenger conversations have no phone, so they simply
        // carry no order/booking history to join on.
        const phones = conversations
            .map(c => c.customerPhone)
            .filter((p): p is string => !!p);

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
            const phone = c.customerPhone;
            const orders = phone ? orderCounts.find(o => o.customerPhone === phone) : undefined;
            const bookings = phone ? bookingCounts.find(b => b.customerPhone === phone) : undefined;

            return {
                // The id is only a list key on the client. Handing over the raw
                // phone here would undo the masking two lines below.
                id: mask ? phoneKey(phone ?? c.id) : (phone ?? c.id),
                // Separate from `id`, which is only a list key: reveal has to
                // address a real record, and the masked id is a one-way hash.
                conversationId: c.id,
                name: c.customerName || 'Unknown',
                phone: phone ? (mask ? maskPhone(phone) : phone) : null,
                handle: c.customerHandle ?? null,
                channel: c.channel,
                contactMasked: mask,
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
