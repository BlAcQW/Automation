import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { audit } from '../../services/audit.js';
import { ADMIN_ROLES, resolveAdminRole } from '../../services/admin-permissions.js';
import { disableTotp } from '../../services/admin-totp.js';
import { adminActor, adminGuard } from './guard.js';
import { revokeAllForAdmin } from './refresh-store.js';

const roleSchema = z.enum(ADMIN_ROLES);

// `role` is REQUIRED and there is no default: whoever creates an admin must
// choose their power on purpose. `.strict()` rejects the old `isSuperAdmin` field.
const createAdminSchema = z
    .object({
        email: z.string().email(),
        password: z.string().min(12, 'Use at least 12 characters'),
        name: z.string().min(2),
        role: roleSchema,
    })
    .strict();

const updateAdminSchema = z
    .object({ role: roleSchema.optional(), isActive: z.boolean().optional() })
    .strict()
    .refine((b) => b.role !== undefined || b.isActive !== undefined, { message: 'Nothing to change' });

const adminPublic = {
    id: true,
    email: true,
    name: true,
    role: true,
    isSuperAdmin: true,
    isActive: true,
    totpEnabledAt: true,
    createdAt: true,
    lastLoginAt: true,
} as const;

const adminManagementRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/admins
    fastify.get('/admins', { preHandler: adminGuard(fastify, 'admins:manage') }, async () => {
        const admins = await fastify.prisma.admin.findMany({
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: adminPublic,
        });
        return { data: admins };
    });

    // POST /admin/admins
    fastify.post('/admins', { preHandler: adminGuard(fastify, 'admins:manage') }, async (request) => {
        const body = createAdminSchema.parse(request.body);

        const existing = await fastify.prisma.admin.findUnique({ where: { email: body.email } });
        if (existing) throw fastify.httpErrors.conflict('Email already registered');

        const admin = await fastify.prisma.admin.create({
            data: {
                email: body.email,
                passwordHash: await bcrypt.hash(body.password, 12),
                name: body.name,
                role: body.role,
                // Legacy column, kept in step until it is dropped.
                isSuperAdmin: body.role === 'OWNER',
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'admin.created',
            ...adminActor(request),
            targetType: 'Admin',
            targetId: admin.id,
            metadata: { email: admin.email, role: body.role },
        });
        return { id: admin.id, email: admin.email, name: admin.name, role: admin.role, isSuperAdmin: admin.isSuperAdmin };
    });

    // PATCH /admin/admins/:id - change role / (de)activate.
    fastify.patch('/admins/:id', { preHandler: adminGuard(fastify, 'admins:manage') }, async (request) => {
        const { id } = z.object({ id: z.string().min(1).max(64) }).parse(request.params);
        const body = updateAdminSchema.parse(request.body);
        const me = request.admin!.adminId;

        if (id === me) {
            throw fastify.httpErrors.badRequest('You cannot change your own role or active state');
        }
        // One transaction that first LOCKS every active OWNER row. Two OWNERs
        // demoting each other at once therefore queue up: the second sees the
        // first's committed change and is refused, instead of both counting
        // "another owner exists" from the same stale snapshot.
        const { target, updated } = await fastify.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "Admin" WHERE "role" = 'OWNER' AND "isActive" = true FOR UPDATE`;

            // Re-check the caller under the lock: they may have been demoted
            // since they authenticated.
            const actor = await tx.admin.findUnique({ where: { id: me }, select: { role: true, isSuperAdmin: true, isActive: true } });
            if (!actor || !actor.isActive || resolveAdminRole(actor) !== 'OWNER') {
                throw fastify.httpErrors.forbidden('Your admin role does not allow this');
            }

            const found = await tx.admin.findUnique({ where: { id } });
            if (!found) throw fastify.httpErrors.notFound('Admin not found');

            const losesOwner =
                found.role === 'OWNER' && found.isActive && ((body.role !== undefined && body.role !== 'OWNER') || body.isActive === false);
            if (losesOwner) {
                const others = await tx.admin.count({
                    where: { role: 'OWNER', isActive: true, id: { not: id } },
                });
                if (others === 0) throw fastify.httpErrors.badRequest('Cannot remove the last active owner');
            }

            const data: { role?: string; isSuperAdmin?: boolean; isActive?: boolean } = {};
            if (body.role !== undefined) {
                data.role = body.role;
                data.isSuperAdmin = body.role === 'OWNER';
            }
            if (body.isActive !== undefined) data.isActive = body.isActive;
            return { target: found, updated: await tx.admin.update({ where: { id }, data, select: adminPublic }) };
        });

        // A changed role or a deactivation takes effect on their next request
        // anyway (the guard re-reads the row); revoking also ends the session
        // families, so nothing issued under the old standing can be refreshed.
        await revokeAllForAdmin(fastify.redis, id);

        await audit({
            prisma: fastify.prisma,
            action: 'admin.updated',
            ...adminActor(request),
            targetType: 'Admin',
            targetId: id,
            metadata: { ...body, previousRole: target.role },
        });
        return updated;
    });

    // POST /admin/admins/:id/reset-2fa - OWNER recovers someone who lost their device.
    fastify.post('/admins/:id/reset-2fa', { preHandler: adminGuard(fastify, 'admins:manage') }, async (request) => {
        const { id } = z.object({ id: z.string().min(1).max(64) }).parse(request.params);
        if (id === request.admin!.adminId) {
            throw fastify.httpErrors.badRequest('Use the normal 2FA settings for your own account');
        }
        const target = await fastify.prisma.admin.findUnique({ where: { id }, select: { id: true } });
        if (!target) throw fastify.httpErrors.notFound('Admin not found');
        await disableTotp(fastify.prisma, id, fastify.redis);
        // A lost device may be in someone else's hands: end every session too.
        await revokeAllForAdmin(fastify.redis, id);
        await audit({
            prisma: fastify.prisma,
            action: 'admin.2fa.reset',
            ...adminActor(request),
            targetType: 'Admin',
            targetId: id,
        });
        return { success: true };
    });
};

export default adminManagementRoutes;
