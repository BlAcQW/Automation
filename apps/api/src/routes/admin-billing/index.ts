/**
 * Admin API for custom billing (A7). Register with prefix /admin/billing.
 *
 * Every route goes through the shared adminGuard (routes/admin/guard.ts), so
 * the role map in services/admin-permissions.ts and the platform's
 * "everyone needs 2FA" policy apply here exactly as on the rest of /admin.
 * Reading (terms, statements, CSV) is `billing:read`; changing terms is
 * `billing:write` (OWNER and FINANCE).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import {
    billingTermsSchema,
    currentMonthKey,
    getStatement,
    statementToCsv,
    type BillingTermsInput,
} from '../../services/billing-usage.js';
import { EVENT_TYPES, EVENT_TYPE_NAMES, isFanOutOnlyType } from '../../services/events/catalogue.js';
import { clearBillingUnitCache } from '../../services/events/publish.js';
import { can } from '../../services/admin-permissions.js';
import { adminGuard } from '../admin/guard.js';

const tenantParams = z.object({ tenantId: z.string().min(1).max(64) });
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM').optional() });
const listQuery = z.object({
    search: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
});

const TERMS_SELECT = {
    currency: true, setupFeeMinor: true, monthlyFeeMinor: true, unitPriceMinor: true,
    unitEventType: true, notes: true, createdAt: true, updatedAt: true,
} as const;

const adminBillingRoutes: FastifyPluginAsync = async (fastify) => {
    const auth = adminGuard(fastify, 'billing:read');
    const editorOnly = adminGuard(fastify, 'billing:write');

    function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
        const r = schema.safeParse(value);
        if (!r.success) throw fastify.httpErrors.badRequest(r.error.issues.map((i) => i.message).join('; '));
        return r.data;
    }

    // Event types that can be a billing unit, with a flag for the high-volume
    // ones (stored regardless of subscriptions once chosen as a unit).
    fastify.get('/event-types', { preHandler: auth }, async () => ({
        data: EVENT_TYPE_NAMES.map((type) => ({
            type,
            description: EVENT_TYPES[type].description,
            highVolume: isFanOutOnlyType(type),
        })),
    }));

    fastify.get('/tenants', { preHandler: auth }, async (request) => {
        const q = parse(listQuery, request.query);
        const rows = await fastify.prisma.tenant.findMany({
            where: q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {},
            select: {
                id: true, name: true, vertical: true, planId: true, timezone: true, isActive: true,
                billingTerms: { select: { currency: true, setupFeeMinor: true, monthlyFeeMinor: true, unitPriceMinor: true, unitEventType: true } },
            },
            orderBy: { name: 'asc' },
            take: q.limit,
        });
        return {
            data: rows.map(({ billingTerms, ...t }) => ({ ...t, terms: billingTerms ?? null })),
        };
    });

    fastify.get('/tenants/:tenantId/terms', { preHandler: auth }, async (request) => {
        const { tenantId } = parse(tenantParams, request.params);
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true, vertical: true, planId: true, timezone: true },
        });
        if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');
        const terms = await fastify.prisma.billingTerms.findUnique({ where: { tenantId }, select: TERMS_SELECT });
        return { tenant, terms: terms ?? null, canEdit: can(request.admin!.role, 'billing:write') };
    });

    fastify.put('/tenants/:tenantId/terms', { preHandler: editorOnly }, async (request) => {
        const { tenantId } = parse(tenantParams, request.params);
        const input: BillingTermsInput = parse(billingTermsSchema, request.body);
        const tenant = await fastify.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
        if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');

        const data = {
            currency: input.currency,
            setupFeeMinor: input.setupFeeMinor,
            monthlyFeeMinor: input.monthlyFeeMinor,
            unitPriceMinor: input.unitPriceMinor,
            unitEventType: input.unitEventType ?? null,
            notes: input.notes ?? null,
        };
        const before = await fastify.prisma.billingTerms.findUnique({ where: { tenantId }, select: TERMS_SELECT });
        const saved = await fastify.prisma.billingTerms.upsert({
            where: { tenantId },
            create: { tenantId, ...data },
            update: data,
            select: TERMS_SELECT,
        });
        // This process must see the new unit type at once; others within the TTL.
        clearBillingUnitCache(tenantId);

        await audit({
            prisma: fastify.prisma,
            action: 'billing.terms.updated',
            actorType: 'ADMIN',
            actorId: request.admin!.adminId,
            tenantId,
            targetType: 'BillingTerms',
            targetId: tenantId,
            metadata: { before, after: data },
            ipAddress: request.ip,
        });
        return { terms: saved };
    });

    async function loadStatement(request: { params: unknown; query: unknown }) {
        const { tenantId } = parse(tenantParams, request.params);
        const { month } = parse(monthQuery, request.query);
        const statement = await getStatement(fastify.prisma as any, tenantId, month);
        if (!statement) throw fastify.httpErrors.notFound('Organisation not found');
        if (month && month > currentMonthKey(new Date(), statement.period.timezone)) {
            throw fastify.httpErrors.badRequest('That month has not started yet');
        }
        return statement;
    }

    fastify.get('/tenants/:tenantId/statement', { preHandler: auth }, async (request) => loadStatement(request));

    fastify.get('/tenants/:tenantId/statement.csv', { preHandler: auth }, async (request, reply) => {
        const statement = await loadStatement(request);
        return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="statement-${statement.tenantId}-${statement.period.month}.csv"`)
            .header('Cache-Control', 'no-store')
            .send(statementToCsv(statement));
    });
};

export default adminBillingRoutes;
