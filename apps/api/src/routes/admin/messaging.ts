/**
 * Messaging health (A3): how well outbound messages are actually landing.
 *
 *  - Per-tenant delivery/failure rates from Message.status (Meta's receipts).
 *  - What Meta billed things as (Message.billingCategory / billable).
 *  - Platform-SMS usage against the per-tenant budget (Bookly's own money).
 *
 * Everything is windowed (default 7 days, max 30) and capped.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { DEFAULT_MONTHLY_SMS_BUDGET } from '../../services/sms-route.js';
import { currentCycleKey } from '../../services/usage.js';
import { adminGuard } from './guard.js';

const DAY_MS = 86_400_000;
const TENANT_ROWS = 50;
const SMS_ROWS = 20;
const SMS_SCAN = 500;
const RAW_ROW_CAP = 5000;

export const healthQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(30).default(7),
    /** Hide tenants with fewer outbound messages than this from the table. */
    minVolume: z.coerce.number().int().min(1).max(100_000).default(1),
});

export interface DeliveryStats {
    total: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    /** No status webhook yet (or channel with no receipts, e.g. SMS/email). */
    noReceipt: number;
    /** failed / messages that have a receipt; null when none do. */
    failureRate: number | null;
    /** (delivered + read) / messages that have a receipt; null when none do. */
    deliveryRate: number | null;
}

export function deliveryStats(counts: Record<string, number>): DeliveryStats {
    const sent = counts.SENT ?? 0;
    const delivered = counts.DELIVERED ?? 0;
    const read = counts.READ ?? 0;
    const failed = counts.FAILED ?? 0;
    const noReceipt = counts.none ?? 0;
    const withReceipt = sent + delivered + read + failed;
    return {
        total: withReceipt + noReceipt,
        sent, delivered, read, failed, noReceipt,
        failureRate: withReceipt > 0 ? failed / withReceipt : null,
        deliveryRate: withReceipt > 0 ? (delivered + read) / withReceipt : null,
    };
}

export async function buildMessagingHealth(
    prisma: any,
    opts: { days: number; minVolume: number; now?: Date },
) {
    const now = opts.now ?? new Date();
    const since = new Date(now.getTime() - opts.days * DAY_MS);

    const [statusRows, billingRows, smsRows] = await Promise.all([
        // Message has no tenantId column, so group through its conversation.
        prisma.$queryRaw`
            SELECT c."tenantId" AS "tenantId", m."status"::text AS "status", COUNT(*)::int AS "n"
            FROM "Message" m
            JOIN "Conversation" c ON c."id" = m."conversationId"
            WHERE m."direction" = 'OUTBOUND' AND m."createdAt" >= ${since}
            GROUP BY c."tenantId", m."status"
            LIMIT ${RAW_ROW_CAP}` as Promise<Array<{ tenantId: string; status: string | null; n: number }>>,
        prisma.message.groupBy({
            by: ['billingCategory', 'billable'],
            where: { direction: 'OUTBOUND', billingCategory: { not: null }, createdAt: { gte: since } },
            _count: { _all: true },
        }),
        prisma.tenantUsage.findMany({
            where: { platformSmsCount: { gt: 0 }, updatedAt: { gte: new Date(now.getTime() - 35 * DAY_MS) } },
            orderBy: { platformSmsCount: 'desc' },
            take: SMS_SCAN,
            select: { tenantId: true, month: true, platformSmsCount: true },
        }),
    ]);

    // Per-tenant status counts.
    const perTenant = new Map<string, Record<string, number>>();
    const overall: Record<string, number> = {};
    for (const r of statusRows) {
        const key = r.status ?? 'none';
        const c = perTenant.get(r.tenantId) ?? {};
        c[key] = (c[key] ?? 0) + r.n;
        perTenant.set(r.tenantId, c);
        overall[key] = (overall[key] ?? 0) + r.n;
    }

    // Tenant names (+ cycle anchors for the SMS rows) in one bounded lookup.
    const smsTenantIds = smsRows.map((r: any) => r.tenantId);
    const ids = [...new Set([...perTenant.keys(), ...smsTenantIds])].slice(0, 1000);
    const tenantRows: Array<{ id: string; name: string; quotaCycleStart: Date | null; createdAt: Date }> = ids.length
        ? await prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, quotaCycleStart: true, createdAt: true }, take: ids.length })
        : [];
    const byId = new Map(tenantRows.map((t) => [t.id, t]));

    const tenants = [...perTenant.entries()]
        .map(([tenantId, counts]) => ({ tenantId, tenantName: byId.get(tenantId)?.name ?? null, ...deliveryStats(counts) }))
        .filter((t) => t.total >= opts.minVolume)
        // Worst failure rate first; unknown rates last; bigger volume breaks ties.
        .sort((a, b) => (b.failureRate ?? -1) - (a.failureRate ?? -1) || b.total - a.total)
        .slice(0, TENANT_ROWS);

    const billing = (billingRows as Array<{ billingCategory: string; billable: boolean | null; _count: { _all: number } }>).reduce(
        (acc, r) => {
            const e = acc.get(r.billingCategory) ?? { category: r.billingCategory, total: 0, billable: 0, free: 0 };
            e.total += r._count._all;
            if (r.billable) e.billable += r._count._all; else e.free += r._count._all;
            acc.set(r.billingCategory, e);
            return acc;
        },
        new Map<string, { category: string; total: number; billable: number; free: number }>(),
    );

    const budget = config.platformSms?.monthlyBudget ?? DEFAULT_MONTHLY_SMS_BUDGET;
    const sms = smsRows
        .filter((r: any) => {
            const t = byId.get(r.tenantId);
            return !!t && currentCycleKey(t, now) === r.month; // this tenant's CURRENT cycle only
        })
        .map((r: any) => ({
            tenantId: r.tenantId, tenantName: byId.get(r.tenantId)?.name ?? null,
            used: r.platformSmsCount, budget, percent: budget > 0 ? Math.floor((r.platformSmsCount / budget) * 100) : 100,
        }))
        .sort((a: any, b: any) => b.percent - a.percent);

    return {
        generatedAt: now.toISOString(),
        windowDays: opts.days,
        totals: deliveryStats(overall),
        tenants,
        billing: [...billing.values()].sort((a, b) => b.total - a.total),
        sms: {
            budgetPerTenant: budget,
            totalUsed: sms.reduce((s: number, r: any) => s + r.used, 0),
            tenants: sms.slice(0, SMS_ROWS),
        },
    };
}

const messagingRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/messaging/health
    fastify.get('/messaging/health', { preHandler: adminGuard(fastify, 'messaging:read') }, async (request) => {
        const q = healthQuerySchema.parse(request.query);
        return buildMessagingHealth(fastify.prisma, q);
    });
};

export default messagingRoutes;
