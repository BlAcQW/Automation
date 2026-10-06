import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// Validation schemas
const createServiceSchema = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    price: z.number().min(0),
    durationMinutes: z.number().min(5).max(480),
    category: z.string().optional(),
    // Optional deposit — null/0 means no deposit is required, in which case
    // the booking flow stays the same as before Phase 3d.
    depositAmount: z.number().min(0).nullable().optional(),
});

const updateServiceSchema = createServiceSchema.partial().extend({
    isActive: z.boolean().optional(),
});

const servicesRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /services - List all services for tenant
    fastify.get('/', async (request) => {
        const services = await fastify.prisma.service.findMany({
            where: { tenantId: request.user.tenantId },
            orderBy: { createdAt: 'desc' },
        });

        return { data: services };
    });

    // GET /services/active - List only active services
    fastify.get('/active', async (request) => {
        const services = await fastify.prisma.service.findMany({
            where: {
                tenantId: request.user.tenantId,
                isActive: true,
            },
            orderBy: { category: 'asc' },
        });

        return { data: services };
    });

    // GET /services/categories - Get unique categories
    fastify.get('/categories', async (request) => {
        const services = await fastify.prisma.service.findMany({
            where: {
                tenantId: request.user.tenantId,
                isActive: true,
                category: { not: null },
            },
            select: { category: true },
            distinct: ['category'],
        });

        const categories = services
            .map((s) => s.category)
            .filter((c): c is string => c !== null);

        return { data: categories };
    });

    // GET /services/:id - Get single service
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const service = await fastify.prisma.service.findFirst({
            where: {
                id,
                tenantId: request.user.tenantId,
            },
        });

        if (!service) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        return service;
    });

    // POST /services - Create new service
    fastify.post('/', async (request) => {
        const body = createServiceSchema.parse(request.body);

        const service = await fastify.prisma.service.create({
            data: {
                tenantId: request.user.tenantId,
                ...body,
            },
        });

        return service;
    });

    // PATCH /services/:id - Update service
    fastify.patch('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const body = updateServiceSchema.parse(request.body);

        // Verify ownership
        const existing = await fastify.prisma.service.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        const tenantId = request.user.tenantId;
        const { count } = await fastify.prisma.service.updateMany({
            where: { id, tenantId },
            data: body,
        });
        if (count === 0) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        const service = await fastify.prisma.service.findFirst({ where: { id, tenantId } });
        if (!service) {
            throw fastify.httpErrors.notFound('Service not found');
        }
        return service;
    });

    // DELETE /services/:id - Delete service
    fastify.delete('/:id', async (request) => {
        const { id } = request.params as { id: string };

        // Verify ownership
        const existing = await fastify.prisma.service.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        // Check for existing bookings
        const bookingsCount = await fastify.prisma.booking.count({
            where: { serviceId: id, tenantId: request.user.tenantId },
        });

        if (bookingsCount > 0) {
            // Soft delete by deactivating
            await fastify.prisma.service.updateMany({
                where: { id, tenantId: request.user.tenantId },
                data: { isActive: false },
            });
            return { deleted: false, deactivated: true };
        }

        const { count } = await fastify.prisma.service.deleteMany({
            where: { id, tenantId: request.user.tenantId },
        });
        if (count === 0) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        return { deleted: true };
    });

    // POST /services/:id/toggle - Toggle service active status
    fastify.post('/:id/toggle', async (request) => {
        const { id } = request.params as { id: string };

        const existing = await fastify.prisma.service.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!existing) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        const tenantId = request.user.tenantId;
        const { count } = await fastify.prisma.service.updateMany({
            where: { id, tenantId },
            data: { isActive: !existing.isActive },
        });
        if (count === 0) {
            throw fastify.httpErrors.notFound('Service not found');
        }

        const service = await fastify.prisma.service.findFirst({ where: { id, tenantId } });
        if (!service) {
            throw fastify.httpErrors.notFound('Service not found');
        }
        return service;
    });
};

export default servicesRoutes;
