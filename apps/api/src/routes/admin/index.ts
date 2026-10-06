import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { config } from '../../config/index.js';
import { audit } from '../../services/audit.js';
import { adminGuard } from './guard.js';
import adminAuthRoutes from './auth.js';
import adminManagementRoutes from './admins.js';
import attentionRoutes from './attention.js';
import organisationRoutes from './organisation.js';
import moneyRoutes from './money.js';
import auditLogRoutes from './audit-log.js';
import messagingRoutes from './messaging.js';
import supportRoutes from './support.js';
import flowRoutes from './flows.js';
import { PLAN_IDS } from '../../services/plans.js';
import { buildTenantUpdateData, parseTenantUpdate } from './tenant-update.js';
import { resolveGmailCreds, sendEmail } from '../../services/gmail-smtp.js';
import {
    createTenantSchema,
    createTenantWithOwner,
    DuplicateOwnerEmailError,
} from '../../services/tenant-onboarding.js';
import { messagesThisCycleByTenant } from './tenant-usage.js';
import { alertListQuerySchema, buildAlertWhere } from './alerts.js';
import { generatePromoCode, normalizePromoCode } from '../../services/promo.js';
import { can } from '../../services/admin-permissions.js';
import { revokeAllForAdmin } from './refresh-store.js';

// Validation schemas
const updateUserSchema = z.object({
    name: z.string().min(2).optional(),
    isActive: z.boolean().optional(),
    role: z.enum(['OWNER', 'STAFF']).optional(),
});

/**
 * Tenant fields that move money terms. Changing them takes billing:write, not
 * just tenants:write, so SUPPORT cannot hand an organisation a plan or quota.
 */
const BILLING_TENANT_FIELDS = ['planId', 'monthlyMessageQuotaOverride'] as const;
const touchesBillingFields = (body: unknown): boolean =>
    typeof body === 'object' && body !== null && BILLING_TENANT_FIELDS.some((k) => k in body);
/** The plan every organisation starts on; choosing it grants nothing. */
const BASELINE_PLAN = 'free';

const paginationSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
});

const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // Sign-in, refresh, logout, /auth/me and 2FA live in ./auth.ts; admin
    // management in ./admins.ts. Every other route below names a permission via
    // adminGuard (role check, see services/admin-permissions.ts).
    await fastify.register(adminAuthRoutes);
    await fastify.register(adminManagementRoutes);
    // Control room (A3), support access + switches (A5), workflow editor (A6).
    await fastify.register(attentionRoutes);
    await fastify.register(organisationRoutes);
    await fastify.register(moneyRoutes);
    await fastify.register(auditLogRoutes);
    await fastify.register(messagingRoutes);
    await fastify.register(supportRoutes);
    await fastify.register(flowRoutes);

    // ============================================
    // TENANT MANAGEMENT
    // ============================================

    // POST /admin/tenants - Create an organisation with an OWNER invite
    fastify.post('/tenants', {
        preHandler: adminGuard(fastify, 'tenants:write'),
    }, async (request, reply) => {
        const parsed = createTenantSchema.safeParse(request.body);
        if (!parsed.success) {
            throw fastify.httpErrors.badRequest(
                parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
            );
        }

        // A paid plan or a message-quota override at creation is a billing
        // decision, same as changing it later.
        const grantsBilling =
            parsed.data.planId !== BASELINE_PLAN ||
            (parsed.data.monthlyMessageQuotaOverride !== undefined && parsed.data.monthlyMessageQuotaOverride !== null);
        if (grantsBilling && !can(request.admin!.role, 'billing:write')) {
            throw fastify.httpErrors.forbidden('Choosing a paid plan or a message quota needs billing access');
        }

        // Account email always goes from the platform sender.
        const creds = resolveGmailCreds({
            tenantGmailUser: null,
            tenantGmailAppPasswordEncrypted: null,
            tenantGmailFromName: null,
        });

        let result;
        try {
            result = await createTenantWithOwner(
                {
                    prisma: fastify.prisma as any,
                    secret: config.jwtSecret,
                    frontendUrl: config.frontendUrl,
                    emailConfigured: !!creds,
                    sendInvite: (mail) => sendEmail({ ...creds!, ...mail }),
                },
                parsed.data,
            );
        } catch (err) {
            if (err instanceof DuplicateOwnerEmailError) {
                throw fastify.httpErrors.conflict('A user with this email already exists');
            }
            throw err;
        }

        // Never put the invite link in the audit trail: it is a credential.
        await audit({
            prisma: fastify.prisma,
            action: 'tenant.created',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            tenantId: result.tenant.id,
            targetType: 'Tenant',
            targetId: result.tenant.id,
            metadata: {
                name: result.tenant.name,
                vertical: result.tenant.vertical,
                planId: result.tenant.planId,
                monthlyMessageQuotaOverride: result.tenant.monthlyMessageQuotaOverride ?? null,
                ownerUserId: result.owner.id,
                ownerEmail: result.owner.email,
                inviteSent: result.invite.sent,
            },
            ipAddress: request.ip,
        });

        reply.code(201);
        return {
            tenant: {
                id: result.tenant.id,
                name: result.tenant.name,
                timezone: result.tenant.timezone,
                vertical: result.tenant.vertical,
                planId: result.tenant.planId,
                monthlyMessageQuotaOverride: result.tenant.monthlyMessageQuotaOverride ?? null,
            },
            owner: { id: result.owner.id, name: result.owner.name, email: result.owner.email },
            invite: result.invite,
        };
    });

    // ============================================
    // PLATFORM ALERTS
    // ============================================

    // GET /admin/alerts - paginated, newest lastSeenAt first
    fastify.get('/alerts', {
        preHandler: adminGuard(fastify, 'alerts:read'),
    }, async (request) => {
        const query = alertListQuerySchema.parse(request.query);
        const where = buildAlertWhere(query);
        const [alerts, total] = await Promise.all([
            fastify.prisma.platformAlert.findMany({
                where,
                orderBy: { lastSeenAt: 'desc' },
                skip: (query.page - 1) * query.limit,
                take: query.limit,
            }),
            fastify.prisma.platformAlert.count({ where }),
        ]);

        const tenantIds = [...new Set(alerts.map((a) => a.tenantId).filter((x): x is string => !!x))];
        const tenants = tenantIds.length
            ? await fastify.prisma.tenant.findMany({
                where: { id: { in: tenantIds } },
                select: { id: true, name: true },
            })
            : [];
        const names = new Map(tenants.map((t) => [t.id, t.name]));

        return {
            data: alerts.map((a) => ({ ...a, tenantName: a.tenantId ? names.get(a.tenantId) ?? null : null })),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // POST /admin/alerts/:id/resolve
    fastify.post('/alerts/:id/resolve', {
        preHandler: adminGuard(fastify, 'alerts:write'),
    }, async (request) => {
        const { id } = request.params as { id: string };
        const adminId = request.admin!.adminId;

        // Only flip an open alert, atomically: a double click must not
        // overwrite who resolved it first.
        const res = await fastify.prisma.platformAlert.updateMany({
            where: { id, resolvedAt: null },
            data: { resolvedAt: new Date(), resolvedBy: adminId },
        });
        const alert = await fastify.prisma.platformAlert.findUnique({ where: { id } });
        if (!alert) throw fastify.httpErrors.notFound('Alert not found');

        if (res.count > 0) {
            await audit({
                prisma: fastify.prisma,
                action: 'alert.resolved',
                actorType: 'ADMIN',
                actorId: adminId,
                tenantId: alert.tenantId,
                targetType: 'PlatformAlert',
                targetId: alert.id,
                metadata: { kind: alert.kind, severity: alert.severity },
                ipAddress: request.ip,
            });
        }
        return alert;
    });

    // GET /admin/tenants - List all tenants
    fastify.get('/tenants', {
        preHandler: adminGuard(fastify, 'tenants:read'),
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
                },
            }),
            fastify.prisma.tenant.count({ where }),
        ]);

        // Each tenant has its own 30-day quota cycle: read the exact row for it.
        const usage = await messagesThisCycleByTenant(fastify.prisma, tenants);

        return {
            data: tenants.map((t) => {
                const messagesThisCycle = usage.get(t.id) ?? 0;
                return {
                    id: t.id,
                    name: t.name,
                    timezone: t.timezone,
                    isActive: t.isActive,
                    planId: t.planId,
                    vertical: t.vertical,
                    monthlyMessageQuotaOverride: t.monthlyMessageQuotaOverride,
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
        preHandler: adminGuard(fastify, 'tenants:read'),
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

        const usage = await messagesThisCycleByTenant(fastify.prisma, [tenant]);

        return {
            id: tenant.id,
            name: tenant.name,
            timezone: tenant.timezone,
            isActive: tenant.isActive,
            planId: tenant.planId,
            vertical: tenant.vertical,
            monthlyMessageQuotaOverride: tenant.monthlyMessageQuotaOverride,
            messagesThisMonth: usage.get(tenant.id) ?? 0,
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
        // plan / quota need billing:write; anything else needs tenants:write.
        // A body mixing both needs both (checked below once parsed).
        preHandler: adminGuard(fastify, (r) => (touchesBillingFields(r.body) ? 'billing:write' : 'tenants:write')),
    }, async (request) => {
        const { id } = request.params as { id: string };
        const parsed = parseTenantUpdate(request.body);
        if (!parsed.success) {
            throw fastify.httpErrors.badRequest(
                parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
            );
        }
        const body = parsed.data;

        const onlyBilling = Object.keys(body).every((k) => (BILLING_TENANT_FIELDS as readonly string[]).includes(k));
        if (!onlyBilling && !can(request.admin!.role, 'tenants:write')) {
            throw fastify.httpErrors.forbidden('Your admin role does not allow this');
        }

        const existing = await fastify.prisma.tenant.findUnique({
            where: { id },
            select: { vertical: true, planId: true, monthlyMessageQuotaOverride: true },
        });
        if (!existing) {
            throw fastify.httpErrors.notFound('Tenant not found');
        }

        // Optimistic concurrency: the vertical's defaults were computed from
        // the vertical we just read, so only apply them if it is unchanged.
        // A concurrent change gets a 409 rather than a wrong deposit default.
        const applied = await fastify.prisma.tenant.updateMany({
            where: { id, vertical: existing.vertical },
            data: buildTenantUpdateData(body, existing.vertical),
        });
        if (applied.count === 0) {
            throw fastify.httpErrors.conflict('Tenant was changed by someone else — reload and try again');
        }
        const tenant = await fastify.prisma.tenant.findUniqueOrThrow({ where: { id } });

        await audit({
            prisma: fastify.prisma,
            action: 'tenant.updated',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            tenantId: tenant.id,
            targetType: 'Tenant',
            targetId: tenant.id,
            metadata: {
                ...(body as Record<string, unknown>),
                // What the money terms were before, so a plan/quota change is reviewable.
                before: { planId: existing.planId, monthlyMessageQuotaOverride: existing.monthlyMessageQuotaOverride },
            },
            ipAddress: request.ip,
        });

        return {
            id: tenant.id,
            name: tenant.name,
            timezone: tenant.timezone,
            isActive: tenant.isActive,
            vertical: tenant.vertical,
            monthlyMessageQuotaOverride: tenant.monthlyMessageQuotaOverride,
        };
    });

    // DELETE /admin/tenants/:id - Disable tenant (soft delete)
    fastify.delete('/tenants/:id', {
        preHandler: adminGuard(fastify, 'tenants:delete'),
    }, async (request) => {
        const { id } = request.params as { id: string };

        const existing = await fastify.prisma.tenant.findUnique({ where: { id }, select: { id: true, isActive: true } });
        if (!existing) throw fastify.httpErrors.notFound('Tenant not found');

        await fastify.prisma.tenant.update({
            where: { id },
            data: { isActive: false },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'tenant.deactivated',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            tenantId: id,
            targetType: 'Tenant',
            targetId: id,
            metadata: { wasActive: existing.isActive },
            ipAddress: request.ip,
        });

        return { success: true };
    });

    // ============================================
    // USER MANAGEMENT
    // ============================================

    // GET /admin/users - List all users
    fastify.get('/users', {
        preHandler: adminGuard(fastify, 'users:read'),
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
        preHandler: adminGuard(fastify, 'users:read'),
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
        preHandler: adminGuard(fastify, 'users:write'),
    }, async (request) => {
        const { id } = request.params as { id: string };
        const body = updateUserSchema.parse(request.body);

        // An OWNER can withdraw money. Only an OWNER admin may hand that out.
        if (body.role === 'OWNER' && request.admin!.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only an owner admin can make a user an owner');
        }

        const before = await fastify.prisma.user.findUnique({
            where: { id },
            select: { id: true, tenantId: true, name: true, role: true, isActive: true },
        });
        if (!before) throw fastify.httpErrors.notFound('User not found');

        const user = await fastify.prisma.user.update({
            where: { id },
            data: body,
        });

        // Before/after of just the fields that were sent (no email or other PII).
        const changed = Object.keys(body) as Array<keyof typeof body>;
        await audit({
            prisma: fastify.prisma,
            action: 'user.updated',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            tenantId: before.tenantId,
            targetType: 'User',
            targetId: id,
            metadata: {
                before: Object.fromEntries(changed.map((k) => [k, before[k]])),
                after: Object.fromEntries(changed.map((k) => [k, user[k]])),
            },
            ipAddress: request.ip,
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
        preHandler: adminGuard(fastify, 'bookings:read'),
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
        preHandler: adminGuard(fastify, 'stats:read'),
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

    // PATCH /admin/auth/password - Change your own admin password.
    fastify.patch('/auth/password', {
        preHandler: adminGuard(fastify, 'self'),
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
        // A changed password must end every other session: stamp a cutoff so
        // every refresh token issued up to now is refused (access tokens run
        // out on their own within minutes; this device signs in again then).
        await revokeAllForAdmin(fastify.redis, admin.id);
        await audit({
            prisma: fastify.prisma,
            action: 'admin.password.changed',
            actorType: 'ADMIN',
            actorId: admin.id,
            targetType: 'Admin',
            targetId: admin.id,
            ipAddress: request.ip,
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
    fastify.get('/promo-codes', { preHandler: adminGuard(fastify, 'promos:read') }, async () => {
        const codes = await fastify.prisma.promoCode.findMany({
            orderBy: { createdAt: 'desc' },
            select: promoSelect,
        });
        return { data: codes };
    });

    // POST /admin/promo-codes
    fastify.post('/promo-codes', { preHandler: adminGuard(fastify, 'promos:write') }, async (request) => {
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
    fastify.patch('/promo-codes/:id', { preHandler: adminGuard(fastify, 'promos:write') }, async (request) => {
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
    fastify.get('/promo-codes/:id/redemptions', { preHandler: adminGuard(fastify, 'promos:read') }, async (request) => {
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
