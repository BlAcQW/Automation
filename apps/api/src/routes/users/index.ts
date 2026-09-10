import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { audit } from '../../services/audit.js';

/**
 * Tenant user (staff) management. OWNER-only. Enables a business owner to add
 * staff accounts that can log in, view bookings, and reply to conversations.
 * (Backend gap G5 from the mobile PRD.)
 */
const usersRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /users - list this tenant's users
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
        const users = await fastify.prisma.user.findMany({
            where: { tenantId: request.user.tenantId },
            select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
        return { users };
    });

    // POST /users - create a STAFF user (owner only)
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the owner can add team members');
        }

        const body = z.object({
            email: z.string().email(),
            password: z.string().min(8),
            name: z.string().min(2),
        }).parse(request.body);

        const existing = await fastify.prisma.user.findFirst({
            where: { tenantId: request.user.tenantId, email: body.email },
            select: { id: true },
        });
        if (existing) {
            throw fastify.httpErrors.conflict('A user with that email already exists');
        }

        const passwordHash = await bcrypt.hash(body.password, 12);
        const user = await fastify.prisma.user.create({
            data: {
                tenantId: request.user.tenantId,
                email: body.email,
                passwordHash,
                name: body.name,
                role: 'STAFF',
            },
            select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'users.staff_created',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            targetType: 'USER',
            targetId: user.id,
            ipAddress: request.ip,
        });

        return user;
    });

    // PATCH /users/:id - update a team member (owner only): rename or (de)activate
    fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the owner can manage team members');
        }
        const { id } = request.params as { id: string };
        const body = z.object({
            name: z.string().min(2).optional(),
            isActive: z.boolean().optional(),
        }).parse(request.body);

        if (id === request.user.userId && body.isActive === false) {
            throw fastify.httpErrors.badRequest('You cannot deactivate your own account');
        }

        // Scope the update to the caller's tenant so an owner can't touch another
        // tenant's users even if they guess an id.
        const target = await fastify.prisma.user.findFirst({
            where: { id, tenantId: request.user.tenantId },
            select: { id: true, role: true },
        });
        if (!target) throw fastify.httpErrors.notFound('User not found');
        if (target.role === 'OWNER' && body.isActive === false) {
            throw fastify.httpErrors.badRequest('The owner account cannot be deactivated');
        }

        const user = await fastify.prisma.user.update({
            where: { id },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.isActive !== undefined && { isActive: body.isActive }),
            },
            select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'users.staff_updated',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            targetType: 'USER',
            targetId: id,
            metadata: { name: body.name, isActive: body.isActive },
            ipAddress: request.ip,
        });

        return user;
    });
};

export default usersRoutes;
