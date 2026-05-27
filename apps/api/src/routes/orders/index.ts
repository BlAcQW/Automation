import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { generatePublicToken } from '../../lib/public-token.js';

// Validation schemas
const orderItemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
});

const createOrderSchema = z.object({
    customerName: z.string().min(2),
    customerPhone: z.string().min(10),
    items: z.array(orderItemSchema).min(1),
    deliveryAddress: z.string().optional(),
    notes: z.string().optional(),
});

const updateOrderSchema = z.object({
    status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
    paymentStatus: z.enum(['UNPAID', 'PAID', 'REFUNDED']).optional(),
    notes: z.string().optional(),
});

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /orders - List all orders
    fastify.get('/', async (request) => {
        const query = z.object({
            status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
            paymentStatus: z.enum(['UNPAID', 'PAID', 'REFUNDED']).optional(),
            from: z.string().optional(),
            to: z.string().optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
        }).parse(request.query);

        const where: any = { tenantId: request.user.tenantId };

        if (query.status) where.status = query.status;
        if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
        if (query.from) where.createdAt = { ...where.createdAt, gte: new Date(query.from) };
        if (query.to) where.createdAt = { ...where.createdAt, lte: new Date(query.to) };

        const skip = (query.page - 1) * query.limit;

        const [orders, total] = await Promise.all([
            fastify.prisma.order.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    items: {
                        include: {
                            product: { select: { id: true, name: true, imageUrl: true } },
                        },
                    },
                },
            }),
            fastify.prisma.order.count({ where }),
        ]);

        return {
            data: orders,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /orders/recent - Get recent orders
    fastify.get('/recent', async (request) => {
        const orders = await fastify.prisma.order.findMany({
            where: { tenantId: request.user.tenantId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
                items: {
                    include: {
                        product: { select: { name: true } },
                    },
                },
            },
        });

        return { data: orders };
    });

    // GET /orders/stats - Get order statistics
    fastify.get('/stats', async (request) => {
        const tenantId = request.user.tenantId;

        const [total, pending, confirmed, delivered, revenue] = await Promise.all([
            fastify.prisma.order.count({ where: { tenantId } }),
            fastify.prisma.order.count({ where: { tenantId, status: 'PENDING' } }),
            fastify.prisma.order.count({ where: { tenantId, status: 'CONFIRMED' } }),
            fastify.prisma.order.count({ where: { tenantId, status: 'DELIVERED' } }),
            fastify.prisma.order.aggregate({
                where: { tenantId, paymentStatus: 'PAID' },
                _sum: { totalAmount: true },
            }),
        ]);

        return {
            total,
            pending,
            confirmed,
            delivered,
            revenue: revenue._sum.totalAmount || 0,
        };
    });

    // GET /orders/:id - Get single order
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const order = await fastify.prisma.order.findFirst({
            where: { id, tenantId: request.user.tenantId },
            include: {
                items: {
                    include: {
                        product: true,
                    },
                },
            },
        });

        if (!order) {
            throw fastify.httpErrors.notFound('Order not found');
        }

        return order;
    });

    // GET /orders/by-reference/:ref - Get order by reference
    fastify.get('/by-reference/:ref', async (request) => {
        const { ref } = request.params as { ref: string };

        const order = await fastify.prisma.order.findFirst({
            where: {
                orderRef: ref,
                tenantId: request.user.tenantId,
            },
            include: {
                items: {
                    include: { product: true },
                },
            },
        });

        if (!order) {
            throw fastify.httpErrors.notFound('Order not found');
        }

        return order;
    });

    // POST /orders - Create new order
    fastify.post('/', async (request) => {
        const body = createOrderSchema.parse(request.body);
        const tenantId = request.user.tenantId;

        // Get products and validate
        const productIds = body.items.map((item) => item.productId);
        const products = await fastify.prisma.product.findMany({
            where: {
                id: { in: productIds },
                tenantId,
                isActive: true,
            },
        });

        if (products.length !== productIds.length) {
            throw fastify.httpErrors.badRequest('One or more products not found or inactive');
        }

        // Create product map for quick lookup
        const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]));

        // Calculate total and prepare items
        let totalAmount = 0;
        const orderItems = body.items.map((item) => {
            const product = productMap.get(item.productId)!;
            const unitPrice = Number(product.price);
            totalAmount += unitPrice * item.quantity;
            return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice,
            };
        });

        // Create order with items in transaction
        const order = await fastify.prisma.$transaction(async (tx: any) => {
            // Check stock availability
            for (const item of body.items) {
                const product = productMap.get(item.productId)!;
                if (product.stock < item.quantity) {
                    throw new Error(`Insufficient stock for ${product.name}`);
                }
            }

            // Create order
            const newOrder = await tx.order.create({
                data: {
                    tenantId,
                    orderRef: `ORD-${nanoid(8).toUpperCase()}`,
                    customerName: body.customerName,
                    customerPhone: body.customerPhone,
                    totalAmount,
                    deliveryAddress: body.deliveryAddress,
                    notes: body.notes,
                    publicToken: generatePublicToken(),
                    items: {
                        create: orderItems,
                    },
                },
                include: {
                    items: {
                        include: { product: true },
                    },
                },
            });

            // Reduce stock
            for (const item of body.items) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.quantity } },
                });
            }

            return newOrder;
        });

        return order;
    });

    // PATCH /orders/:id - Update order
    fastify.patch('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const body = updateOrderSchema.parse(request.body);

        const existing = await fastify.prisma.order.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Order not found');
        }

        const order = await fastify.prisma.order.update({
            where: { id },
            data: body,
            include: {
                items: {
                    include: { product: true },
                },
            },
        });

        return order;
    });

    // POST /orders/:id/cancel - Cancel order and restore stock
    fastify.post('/:id/cancel', async (request) => {
        const { id } = request.params as { id: string };

        const existing = await fastify.prisma.order.findFirst({
            where: { id, tenantId: request.user.tenantId },
            include: { items: true },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Order not found');
        }

        if (existing.status === 'CANCELLED') {
            throw fastify.httpErrors.badRequest('Order already cancelled');
        }

        if (existing.status === 'DELIVERED') {
            throw fastify.httpErrors.badRequest('Cannot cancel delivered order');
        }

        // Cancel and restore stock in transaction
        const order = await fastify.prisma.$transaction(async (tx: any) => {
            // Restore stock
            for (const item of existing.items) {
                await tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { increment: item.quantity } },
                });
            }

            // Update order status
            return tx.order.update({
                where: { id },
                data: { status: 'CANCELLED' },
            });
        });

        return order;
    });

    // GET /orders/customer/:phone - Get orders by customer phone
    fastify.get('/customer/:phone', async (request) => {
        const { phone } = request.params as { phone: string };

        const orders = await fastify.prisma.order.findMany({
            where: {
                tenantId: request.user.tenantId,
                customerPhone: phone,
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
                items: {
                    include: { product: { select: { name: true } } },
                },
            },
        });

        return { data: orders };
    });
};

export default ordersRoutes;
