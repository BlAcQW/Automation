/**
 * Audit log viewer (A3). Read-only, newest first, filterable by tenant, actor,
 * action and date. Always bounded: a date window of at most MAX_RANGE_DAYS
 * (default: last 7 days) and keyset pagination, so no request can scan the
 * whole append-only table.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { adminGuard } from './guard.js';

export const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 7;
const DAY_MS = 86_400_000;

export const auditQuerySchema = z
    .object({
        tenantId: z.string().min(1).max(64).optional(),
        actorId: z.string().min(1).max(64).optional(),
        actorType: z.enum(['USER', 'ADMIN', 'BOT', 'SYSTEM']).optional(),
        action: z.string().min(1).max(100).optional(),
        actionPrefix: z.string().min(1).max(100).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        cursor: z.string().min(1).max(64).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .superRefine((q, ctx) => {
        if (q.action && q.actionPrefix) {
            ctx.addIssue({ code: 'custom', message: 'Use either action or actionPrefix, not both' });
        }
        const from = q.from ? new Date(q.from).getTime() : undefined;
        const to = q.to ? new Date(q.to).getTime() : undefined;
        if (from !== undefined && to !== undefined) {
            if (to < from) ctx.addIssue({ code: 'custom', message: '"to" is before "from"' });
            else if (to - from > MAX_RANGE_DAYS * DAY_MS) ctx.addIssue({ code: 'custom', message: `The window can be at most ${MAX_RANGE_DAYS} days` });
        } else if (from !== undefined && Date.now() - from > MAX_RANGE_DAYS * DAY_MS) {
            ctx.addIssue({ code: 'custom', message: `The window can be at most ${MAX_RANGE_DAYS} days` });
        }
    });

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function buildAuditWhere(q: AuditQuery, now: Date = new Date()) {
    const to = q.to ? new Date(q.to) : now;
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    return {
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.actorType ? { actorType: q.actorType } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.actionPrefix ? { action: { startsWith: q.actionPrefix } } : {}),
        createdAt: { gte: from, lte: to },
    } as Record<string, any>;
}

const auditLogRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/audit
    fastify.get('/audit', { preHandler: adminGuard(fastify, 'audit:read') }, async (request) => {
        const q = auditQuerySchema.parse(request.query);
        const rows = await fastify.prisma.auditLog.findMany({
            where: buildAuditWhere(q),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: q.limit + 1,
            ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
            select: {
                id: true, tenantId: true, actorType: true, actorId: true, action: true,
                targetType: true, targetId: true, metadata: true, ipAddress: true, createdAt: true,
            },
        });
        const hasMore = rows.length > q.limit;
        const page = hasMore ? rows.slice(0, q.limit) : rows;

        const adminIds = [...new Set(page.filter((r) => r.actorType === 'ADMIN' && r.actorId).map((r) => r.actorId as string))];
        const tenantIds = [...new Set(page.map((r) => r.tenantId).filter((t): t is string => !!t))];
        const [admins, tenants] = await Promise.all([
            adminIds.length ? fastify.prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true }, take: adminIds.length }) : [],
            tenantIds.length ? fastify.prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true }, take: tenantIds.length }) : [],
        ]);
        const adminName = new Map(admins.map((a) => [a.id, a.name]));
        const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

        return {
            data: page.map((r) => ({
                ...r,
                actorName: r.actorType === 'ADMIN' && r.actorId ? (adminName.get(r.actorId) ?? null) : null,
                tenantName: r.tenantId ? (tenantName.get(r.tenantId) ?? null) : null,
            })),
            nextCursor: hasMore ? page[page.length - 1].id : null,
        };
    });
};

export default auditLogRoutes;
