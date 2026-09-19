import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateAdminTokenPayload } from '../../plugins/auth.js';
import { config } from '../../config/index.js';
import { audit } from '../../services/audit.js';
import { PLAN_IDS } from '../../services/plans.js';
import { currentCycleKey } from '../../services/usage.js';
import { generatePromoCode, normalizePromoCode } from '../../services/promo.js';

// Validation schemas
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

const createAdminSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
    isSuperAdmin: z.boolean().default(false),
});

const updateTenantSchema = z.object({
    name: z.string().min(2).optional(),
    isActive: z.boolean().optional(),
    timezone: z.string().optional(),
    planId: z.enum(PLAN_IDS).optional(),
});

const updateUserSchema = z.object({
    name: z.string().min(2).optional(),
    isActive: z.boolean().optional(),
    role: z.enum(['OWNER', 'STAFF']).optional(),
});

const paginationSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
});

const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // ============================================
    // ADMIN AUTHENTICATION
    // ============================================

    // POST /admin/auth/login - Admin login
    fastify.post('/auth/login', async (request, reply) => {
        const body = loginSchema.parse(request.body);

        const admin = await fastify.prisma.admin.findUnique({
            where: { email: body.email },
        });

        if (!admin || !admin.isActive) {
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }

        const validPassword = await bcrypt.compare(body.password, admin.passwordHash);
        if (!validPassword) {
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }

        // Update last login
        await fastify.prisma.admin.update({
            where: { id: admin.id },
            data: { lastLoginAt: new Date() },
        });

        // Generate tokens using the ADMIN JWT namespace (separate secret).
        const accessToken = (fastify as any).jwt.admin.sign(
            generateAdminTokenPayload(admin.id, 'admin_access'),
            { expiresIn: config.jwtExpiresIn }
        );

        const refreshToken = (fastify as any).jwt.admin.sign(
            generateAdminTokenPayload(admin.id, 'admin_refresh'),
            { expiresIn: config.jwtRefreshExpiresIn }
        );

        reply.setCookie('adminRefreshToken', refreshToken, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            path: '/admin/auth',
            maxAge: 7 * 24 * 60 * 60,
        });

        return {
            admin: {
                id: admin.id,
                email: admin.email,
                name: admin.name,
                isSuperAdmin: admin.isSuperAdmin,
            },
            accessToken,
        };
    });

    // GET /admin/auth/me - Get current admin
    fastify.get('/auth/me', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const adminId = request.admin!.adminId;

        const admin = await fastify.prisma.admin.findUnique({
            where: { id: adminId },
        });

        if (!admin) {
            throw fastify.httpErrors.notFound('Admin not found');
        }

        return {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            isSuperAdmin: admin.isSuperAdmin,
        };
    });

    // POST /admin/auth/logout - Clear admin refresh token
    fastify.post('/auth/logout', async (request, reply) => {
        reply.clearCookie('adminRefreshToken', { path: '/admin/auth' });
        return { success: true };
    });

    // ============================================
    // TENANT MANAGEMENT
    // ============================================

    // GET /admin/tenants - List all tenants
    fastify.get('/tenants', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const query = paginationSchema.parse(request.query);
        const skip = (query.page - 1) * query.limit;

        const where = query.search
            ? {
                OR: [
                    { name: { contains: query.search, mode: 'insensitive' as const } },
                    { whatsappDisplayNumber: { contains: query.search } },
                ],
            }
            : {};

        const [tenants, total] = await Promise.all([
            fastify.prisma.tenant.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: {
                        select: {
                            users: true,
                            bookings: true,
                            services: true,
                        },
                    },
                    // Phase 4c — each tenant has its own 30-day quota cycle
                    // (keyed YYYY-MM-DD). Fetch the most-recent usage row;
                    // we'll match it against the tenant's current cycle key
                    // below — non-matching rows count as 0 this cycle.
                    tenantUsages: {
                        orderBy: { month: 'desc' },
                        take: 1,
                        select: { month: true, messageCount: true },
                    },
                },
            }),
            fastify.prisma.tenant.count({ where }),
        ]);

        return {
            data: tenants.map((t) => {
                const cycleKey = currentCycleKey({
                    quotaCycleStart: t.quotaCycleStart,
                    createdAt: t.createdAt,
                });
                const latestUsage = t.tenantUsages[0];
                const messagesThisCycle =
                    latestUsage?.month === cycleKey ? latestUsage.messageCount : 0;
                return {
                    id: t.id,
                    name: t.name,
                    timezone: t.timezone,
                    isActive: t.isActive,
                    planId: t.planId,
                    messagesThisMonth: messagesThisCycle,
                    whatsappConnected: !!t.whatsappPhoneNumberId,
                    whatsappDisplayNumber: t.whatsappDisplayNumber,
                    usersCount: t._count.users,
                    bookingsCount: t._count.bookings,
                    servicesCount: t._count.services,
                    createdAt: t.createdAt,
                };
            }),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /admin/tenants/:id - Get tenant details
    fastify.get('/tenants/:id', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { id } = request.params as { id: string };

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id },
            include: {
                users: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        role: true,
                        isActive: true,
                        createdAt: true,
                    },
                },
                _count: {
                    select: {
                        bookings: true,
                        services: true,
                        conversations: true,
                    },
                },
            },
        });

        if (!tenant) {
            throw fastify.httpErrors.notFound('Tenant not found');
        }

        return {
            id: tenant.id,
            name: tenant.name,
            timezone: tenant.timezone,
            isActive: tenant.isActive,
            whatsappConnected: !!tenant.whatsappPhoneNumberId,
            whatsappDisplayNumber: tenant.whatsappDisplayNumber,
            users: tenant.users,
            stats: {
                bookings: tenant._count.bookings,
                services: tenant._count.services,
                conversations: tenant._count.conversations,
            },
            createdAt: tenant.createdAt,
            updatedAt: tenant.updatedAt,
        };
    });

    // PATCH /admin/tenants/:id - Update tenant
    fastify.patch('/tenants/:id', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { id } = request.params as { id: string };
        const body = updateTenantSchema.parse(request.body);

        const tenant = await fastify.prisma.tenant.update({
            where: { id },
            data: body,
        });

        await audit({
            prisma: fastify.prisma,
            action: 'tenant.updated',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            tenantId: tenant.id,
            targetType: 'Tenant',
            targetId: tenant.id,
            metadata: body as Record<string, unknown>,
            ipAddress: request.ip,
        });

        return {
            id: tenant.id,
            name: tenant.name,
            timezone: tenant.timezone,
            isActive: tenant.isActive,
        };
    });

    // DELETE /admin/tenants/:id - Disable tenant (soft delete)
    fastify.delete('/tenants/:id', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { id } = request.params as { id: string };

        await fastify.prisma.tenant.update({
            where: { id },
            data: { isActive: false },
        });

        return { success: true };
    });

    // ============================================
    // USER MANAGEMENT
    // ============================================

    // GET /admin/users - List all users
    fastify.get('/users', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const query = paginationSchema.parse(request.query);
        const skip = (query.page - 1) * query.limit;

        const where = query.search
            ? {
                OR: [
                    { name: { contains: query.search, mode: 'insensitive' as const } },
                    { email: { contains: query.search, mode: 'insensitive' as const } },
                ],
            }
            : {};

        const [users, total] = await Promise.all([
            fastify.prisma.user.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    tenant: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            }),
            fastify.prisma.user.count({ where }),
        ]);

        return {
            data: users.map((u) => ({
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                isActive: u.isActive,
                tenant: u.tenant,
                createdAt: u.createdAt,
            })),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /admin/users/:id - Get user details
    fastify.get('/users/:id', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { id } = request.params as { id: string };

        const user = await fastify.prisma.user.findUnique({
            where: { id },
            include: {
                tenant: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true,
                    },
                },
            },
        });

        if (!user) {
            throw fastify.httpErrors.notFound('User not found');
        }

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: user.isActive,
            tenant: user.tenant,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    });

    // PATCH /admin/users/:id - Update user
    fastify.patch('/users/:id', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { id } = request.params as { id: string };
        const body = updateUserSchema.parse(request.body);

        const user = await fastify.prisma.user.update({
            where: { id },
            data: body,
        });

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: user.isActive,
        };
    });

    // ============================================
    // BOOKINGS OVERVIEW
    // ============================================

    // GET /admin/bookings - List all bookings
    fastify.get('/bookings', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const query = z.object({
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(100).default(20),
            tenantId: z.string().optional(),
            status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
        }).parse(request.query);

        const skip = (query.page - 1) * query.limit;

        const where: any = {};
        if (query.tenantId) where.tenantId = query.tenantId;
        if (query.status) where.status = query.status;

        const [bookings, total] = await Promise.all([
            fastify.prisma.booking.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    tenant: { select: { id: true, name: true } },
                    service: { select: { id: true, name: true } },
                },
            }),
            fastify.prisma.booking.count({ where }),
        ]);

        return {
            data: bookings.map((b) => ({
                id: b.id,
                bookingReference: b.bookingReference,
                customerName: b.customerName,
                customerPhone: b.customerPhone,
                startTime: b.startTime,
                endTime: b.endTime,
                status: b.status,
                tenant: b.tenant,
                service: b.service,
                createdAt: b.createdAt,
            })),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // ============================================
    // PLATFORM STATISTICS
    // ============================================

    // GET /admin/stats - Platform-wide statistics
    fastify.get('/stats', {
        preHandler: [fastify.authenticateAdmin],
    }, async () => {
        const [
            tenantsCount,
            activeTenantsCount,
            usersCount,
            bookingsCount,
            bookingsToday,
            conversationsCount,
        ] = await Promise.all([
            fastify.prisma.tenant.count(),
            fastify.prisma.tenant.count({ where: { isActive: true } }),
            fastify.prisma.user.count(),
            fastify.prisma.booking.count(),
            fastify.prisma.booking.count({
                where: {
                    createdAt: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0)),
                    },
                },
            }),
            fastify.prisma.conversation.count(),
        ]);

        // Get new tenants this month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const newTenantsThisMonth = await fastify.prisma.tenant.count({
            where: {
                createdAt: { gte: startOfMonth },
            },
        });

        return {
            tenants: {
                total: tenantsCount,
                active: activeTenantsCount,
                newThisMonth: newTenantsThisMonth,
            },
            users: {
                total: usersCount,
            },
            bookings: {
                total: bookingsCount,
                today: bookingsToday,
            },
            conversations: {
                total: conversationsCount,
            },
        };
    });

    // ============================================
    // ADMIN MANAGEMENT (Super Admin Only)
    // ============================================

    // GET /admin/admins - List all admins
    fastify.get('/admins', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { isSuperAdmin } = request.admin!;

        if (!isSuperAdmin) {
            throw fastify.httpErrors.forbidden('Super admin access required');
        }

        const admins = await fastify.prisma.admin.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                email: true,
                name: true,
                isSuperAdmin: true,
                isActive: true,
                createdAt: true,
                lastLoginAt: true,
            },
        });

        return { data: admins };
    });

    // POST /admin/admins - Create new admin
    fastify.post('/admins', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const { isSuperAdmin } = request.admin!;

        if (!isSuperAdmin) {
            throw fastify.httpErrors.forbidden('Super admin access required');
        }

        const body = createAdminSchema.parse(request.body);

        // Check if email exists
        const existing = await fastify.prisma.admin.findUnique({
            where: { email: body.email },
        });

        if (existing) {
            throw fastify.httpErrors.conflict('Email already registered');
        }

        const passwordHash = await bcrypt.hash(body.password, 12);

        const admin = await fastify.prisma.admin.create({
            data: {
                email: body.email,
                passwordHash,
                name: body.name,
                isSuperAdmin: body.isSuperAdmin,
            },
        });

        return {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            isSuperAdmin: admin.isSuperAdmin,
        };
    });

    // PATCH /admin/auth/password - Change your own admin password.
    fastify.patch('/auth/password', {
        preHandler: [fastify.authenticateAdmin],
    }, async (request) => {
        const body = z.object({
            currentPassword: z.string(),
            newPassword: z.string().min(12, 'Use at least 12 characters'),
        }).parse(request.body);

        const admin = await fastify.prisma.admin.findUnique({ where: { id: request.admin!.adminId } });
        if (!admin) throw fastify.httpErrors.notFound('Admin not found');
        if (!(await bcrypt.compare(body.currentPassword, admin.passwordHash))) {
            throw fastify.httpErrors.badRequest('Current password is incorrect');
        }
        await fastify.prisma.admin.update({
            where: { id: admin.id },
            data: { passwordHash: await bcrypt.hash(body.newPassword, 12) },
        });
        return { success: true };
    });

    // ============================================
    // PROMO CODES
    // ============================================

    const promoSelect = {
        id: true, code: true, kind: true, days: true, planId: true, description: true,
        maxRedemptions: true, redemptionCount: true, expiresAt: true, isActive: true,
        createdAt: true, createdBy: { select: { name: true } },
    } as const;

    // GET /admin/promo-codes
    fastify.get('/promo-codes', { preHandler: [fastify.authenticateAdmin] }, async () => {
        const codes = await fastify.prisma.promoCode.findMany({
            orderBy: { createdAt: 'desc' },
            select: promoSelect,
        });
        return { data: codes };
    });

    // POST /admin/promo-codes
    fastify.post('/promo-codes', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
        const body = z.object({
            code: z.string().max(40).optional(),
            prefix: z.string().max(12).optional(),
            kind: z.enum(['TRIAL_EXTENSION', 'PLAN_GRANT']),
            days: z.number().int().min(1).max(730),
            planId: z.enum(PLAN_IDS).optional(),
            description: z.string().max(200).optional(),
            maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
            expiresAt: z.string().datetime().nullable().optional(),
        }).parse(request.body);

        if (body.kind === 'PLAN_GRANT' && !body.planId) {
            throw fastify.httpErrors.badRequest('A plan grant needs a plan');
        }
        if (body.kind === 'PLAN_GRANT' && body.planId === 'free') {
            throw fastify.httpErrors.badRequest('Granting the Free plan does nothing');
        }

        const code = body.code ? normalizePromoCode(body.code) : generatePromoCode(body.prefix ?? '');
        if (code.length < 4) throw fastify.httpErrors.badRequest('Code must be at least 4 characters');

        const existing = await fastify.prisma.promoCode.findUnique({ where: { code }, select: { id: true } });
        if (existing) throw fastify.httpErrors.conflict(`Code ${code} already exists`);

        const created = await fastify.prisma.promoCode.create({
            data: {
                code,
                kind: body.kind,
                days: body.days,
                planId: body.kind === 'PLAN_GRANT' ? body.planId : null,
                description: body.description,
                maxRedemptions: body.maxRedemptions ?? null,
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
                createdByAdminId: request.admin!.adminId,
            },
            select: promoSelect,
        });

        await audit({
            prisma: fastify.prisma,
            action: 'admin.promo.created',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            metadata: { code: created.code, kind: created.kind, days: created.days, planId: created.planId },
            ipAddress: request.ip,
        });

        return created;
    });

    // PATCH /admin/promo-codes/:id - pause/resume, edit note, cap or expiry.
    fastify.patch('/promo-codes/:id', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
        const { id } = request.params as { id: string };
        const body = z.object({
            isActive: z.boolean().optional(),
            description: z.string().max(200).nullable().optional(),
            maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
            expiresAt: z.string().datetime().nullable().optional(),
        }).parse(request.body);

        const updated = await fastify.prisma.promoCode.update({
            where: { id },
            data: {
                ...(body.isActive !== undefined && { isActive: body.isActive }),
                ...(body.description !== undefined && { description: body.description }),
                ...(body.maxRedemptions !== undefined && { maxRedemptions: body.maxRedemptions }),
                ...(body.expiresAt !== undefined && { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }),
            },
            select: promoSelect,
        });
        return updated;
    });

    // GET /admin/promo-codes/:id/redemptions - who used it and what it did.
    fastify.get('/promo-codes/:id/redemptions', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
        const { id } = request.params as { id: string };
        const rows = await fastify.prisma.promoRedemption.findMany({
            where: { promoCodeId: id },
            orderBy: { redeemedAt: 'desc' },
            select: { id: true, redeemedAt: true, effect: true, tenant: { select: { id: true, name: true } } },
        });
        return { data: rows };
    });
};

export default adminRoutes;
