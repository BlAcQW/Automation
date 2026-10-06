import { cancelOrderAndRestock } from '../../services/order-expiry.js';
import { createOrderAtomic, OrderError, DASHBOARD_MAX_LINE_QUANTITY } from '../../services/order-create.js';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { maskContact, maskContacts } from '../../services/contact-privacy.js';
import { orderStatusClearsFunds, clearFundsForEntity } from '../../services/wallet-clearing.js';
import { resolveMaskPolicy } from '../../services/contact-privacy-policy.js';
import { cancelMovesMoney } from '../../services/booking-cancel.js';
import { refundOrderPayment, type RefundOrderResult } from '../../services/order-refund.js';
import { raiseAlert } from '../../services/alerts.js';

// Validation schemas
// Dashboard orders may be wholesale, so the per-product cap is the dashboard one
// (createOrderAtomic's own default of 100 is for chat). The schema and the
// service use the same constant, so the API answers with a 400 that names the cap.
const orderItemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().positive().max(
        DASHBOARD_MAX_LINE_QUANTITY,
        `Quantity per product must be a whole number from 1 to ${DASHBOARD_MAX_LINE_QUANTITY}.`,
    ),
});

const createOrderSchema = z.object({
    customerName: z.string().min(2),
    customerPhone: z.string().min(10),
    items: z.array(orderItemSchema).min(1),
    deliveryAddress: z.string().optional(),
    notes: z.string().optional(),
}).superRefine((order, ctx) => {
    // Duplicate lines for a product are merged by createOrderAtomic, and the cap
    // applies to the merged quantity.
    const totals = new Map<string, number>();
    for (const { productId, quantity } of order.items) {
        const total = (totals.get(productId) ?? 0) + quantity;
        totals.set(productId, total);
        if (total > DASHBOARD_MAX_LINE_QUANTITY) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['items'],
                message: `Combined quantity of product ${productId} exceeds ${DASHBOARD_MAX_LINE_QUANTITY} per order.`,
            });
            return;
        }
    }
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

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        return {
            data: maskContacts(orders, mask),
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

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        return { data: maskContacts(orders, mask) };
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

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        return maskContact(order, mask);
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

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        return maskContact(order, mask);
    });

    // POST /orders - Create new order
    fastify.post('/', async (request) => {
        const parsedBody = createOrderSchema.safeParse(request.body);
        if (!parsedBody.success) {
            throw fastify.httpErrors.badRequest(parsedBody.error.issues.map((i) => i.message).join('; '));
        }
        const body = parsedBody.data;
        const tenantId = request.user.tenantId;

        // Currency for the order.created event; best-effort.
        let currency = 'GHS';
        try {
            const tenantRow = await fastify.prisma.tenant.findUnique({ where: { id: tenantId }, select: { paymentCurrency: true } });
            currency = tenantRow?.paymentCurrency ?? currency;
        } catch (err) {
            fastify.log.warn({ err, tenantId }, 'Tenant currency lookup failed; order.created uses the default');
        }

        // Shared with the assistant's create_order tool. The stock decrement
        // is guarded (stock >= quantity) inside the transaction, so two
        // buyers can never both take the last unit and stock never goes
        // negative; any short line rolls the whole order back.
        let order;
        try {
            order = await createOrderAtomic({
                prisma: fastify.prisma,
                tenantId,
                customerName: body.customerName,
                customerPhone: body.customerPhone,
                currency,
                items: body.items,
                maxLineQuantity: DASHBOARD_MAX_LINE_QUANTITY,
                deliveryAddress: body.deliveryAddress,
                notes: body.notes,
                log: fastify.log,
            });
        } catch (err) {
            if (err instanceof OrderError) {
                if (err.code === 'OUT_OF_STOCK') throw fastify.httpErrors.conflict(err.message);
                throw fastify.httpErrors.badRequest(err.message);
            }
            throw err;
        }

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        return maskContact(order, mask);
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

        // Cancelling restocks and may refund: one path for it, never a bare status write.
        if (body.status === 'CANCELLED') {
            if (body.paymentStatus !== undefined || body.notes !== undefined) {
                throw fastify.httpErrors.badRequest('Cancel the order on its own, then make other changes.');
            }
            return cancelFromDashboard(request, id);
        }
        // A cancelled order is over: delivering it would release money owed back to the customer.
        if (body.status && existing.status === 'CANCELLED') {
            throw fastify.httpErrors.badRequest('This order is cancelled and cannot change status.');
        }
        // Platform-collected payment state is written only by the payment and refund flows.
        if (body.paymentStatus !== undefined && existing.collectionRoute === 'PLATFORM') {
            throw fastify.httpErrors.badRequest('The payment status of an order paid through Bookly is updated automatically.');
        }

        const { count } = await fastify.prisma.order.updateMany({
            where: { id, tenantId: request.user.tenantId },
            data: body,
        });
        if (count === 0) {
            throw fastify.httpErrors.notFound('Order not found');
        }
        const order = await fastify.prisma.order.findFirst({
            where: { id, tenantId: request.user.tenantId },
            include: {
                items: {
                    include: { product: true },
                },
            },
        });
        if (!order) {
            throw fastify.httpErrors.notFound('Order not found');
        }

        // Delivered means the work is done, so the money is theirs.
        if (body.status && orderStatusClearsFunds(body.status)) {
            await clearFundsForEntity({
                prisma: fastify.prisma,
                tenantId: request.user.tenantId,
                orderId: order.id,
                logger: fastify.log,
            }).catch((err: unknown) =>
                fastify.log.error({ err, orderId: order.id }, 'Failed to release funds'),
            );
        }

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        return maskContact(order, mask);
    });

    /**
     * The one dashboard cancel, shared by POST /:id/cancel and PATCH {status:
     * CANCELLED} (the mobile app's path): same owner rule, restock and refund.
     */
    async function cancelFromDashboard(request: any, id: string) {

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

        // A paid PLATFORM order is refunded on cancel: money leaving the
        // platform is OWNER only, like a paid booking. Checked before anything
        // changes, so a refused staff cancel touches nothing.
        const movesMoney = cancelMovesMoney(existing);
        if (movesMoney && request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden(
                'This order has been paid, and cancelling it refunds the customer. Only the account owner can do that. Ask the owner to cancel it.',
            );
        }

        // Claim + restock in ONE transaction, guarded on the status still being
        // cancellable: two clicks (or a click racing the expiry sweep) can only
        // restock once. The check above is for the friendly message; this is the lock.
        const cancelled = await cancelOrderAndRestock(fastify.prisma, {
            tenantId: request.user.tenantId,
            orderId: id,
            items: existing.items,
            guard: { status: { notIn: ['CANCELLED', 'DELIVERED'] } },
        });
        if (!cancelled) {
            throw fastify.httpErrors.badRequest('Order was already cancelled or delivered');
        }
        const order = await fastify.prisma.order.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });
        if (!order) {
            throw fastify.httpErrors.notFound('Order not found');
        }

        // The order is already CANCELLED (that flip was the claim), so the
        // refund runs once. A provider refusal is parked and alerted inside the
        // refund service; anything that escapes it is alerted here.
        let refund: RefundOrderResult | { refunded: false; reason: 'error' } | undefined;
        if (movesMoney) {
            try {
                refund = await refundOrderPayment({ prisma: fastify.prisma, tenantId: request.user.tenantId, orderId: id, logger: request.log });
            } catch (err) {
                request.log.error({ err, orderId: id }, 'Order refund threw after cancel; customer is owed the money');
                refund = { refunded: false, reason: 'error' };
                await raiseAlert(fastify.prisma, {
                    kind: 'order.refund_failed',
                    severity: 'critical',
                    tenantId: request.user.tenantId,
                    message: 'A paid order was cancelled but the refund step crashed. A person must check the order and refund the customer.',
                    context: { orderId: id },
                    dedupeKey: `order.refund_failed:${id}`,
                }).catch((alertErr) => request.log.error({ err: alertErr, orderId: id }, 'Could not raise order refund alert'));
            }
        }

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role, !!request.user.support);
        const body = maskContact(order, mask);
        return refund ? { ...body, refund } : body;
    }

    // POST /orders/:id/cancel - Cancel order and restore stock
    fastify.post('/:id/cancel', async (request) => {
        const { id } = request.params as { id: string };
        return cancelFromDashboard(request, id);
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
