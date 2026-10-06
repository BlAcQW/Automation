/**
 * Needs-attention home (A3): what a person should look at right now.
 *
 * One bounded query (or two) per section. Sections are independent: if one
 * query fails it reports `{ error: 'unavailable' }` and the rest still load,
 * so a single bad table never blanks the page that exists to show problems.
 * Money sections are only built for roles that may see money.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { scoped } from '../../lib/logger.js';
import { can } from '../../services/admin-permissions.js';
import { effectiveMessageQuota, getPlan } from '../../services/plans.js';
import { messagesThisCycleByTenant } from './tenant-usage.js';
import { adminGuard } from './guard.js';

const log = scoped('admin-attention');

export const attentionQuerySchema = z.object({
    /** A handoff waiting longer than this with no human reply is "unanswered". */
    handoffMinutes: z.coerce.number().int().min(1).max(1440).default(15),
    /** A tenant at or above this share of its message quota is "near". */
    quotaPercent: z.coerce.number().int().min(50).max(100).default(80),
});

export interface AttentionOptions {
    handoffMinutes: number;
    quotaPercent: number;
    includeMoney: boolean;
    now?: Date;
}

const TOP_ALERTS = 10;
const LIST = 10;
const HANDOFF_CANDIDATES = 100;
const QUOTA_SCAN = 500;
const STUCK_PAYOUT_MS = 60 * 60_000;
const DAY_MS = 24 * 3600_000;

type Section<T> = T | { error: 'unavailable' };

async function section<T>(name: string, fn: () => Promise<T>): Promise<Section<T>> {
    try {
        return await fn();
    } catch (err) {
        log.error({ err, section: name }, 'needs-attention section failed');
        return { error: 'unavailable' };
    }
}

export function maskPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    return digits.length <= 4 ? '••••' : `••• ${digits.slice(-4)}`;
}

async function tenantNames(prisma: any, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))].slice(0, 200);
    if (unique.length === 0) return new Map();
    const rows: Array<{ id: string; name: string }> = await prisma.tenant.findMany({
        where: { id: { in: unique } },
        select: { id: true, name: true },
        take: unique.length,
    });
    return new Map(rows.map((r) => [r.id, r.name]));
}

async function alertsSection(prisma: any) {
    const [groups, critical, warning] = await Promise.all([
        prisma.platformAlert.groupBy({ by: ['severity'], where: { resolvedAt: null }, _count: { _all: true } }),
        prisma.platformAlert.findMany({ where: { resolvedAt: null, severity: 'critical' }, orderBy: { lastSeenAt: 'desc' }, take: TOP_ALERTS }),
        prisma.platformAlert.findMany({ where: { resolvedAt: null, severity: 'warning' }, orderBy: { lastSeenAt: 'desc' }, take: TOP_ALERTS }),
    ]);
    const bySeverity = { critical: 0, warning: 0, info: 0 };
    for (const g of groups as Array<{ severity: string; _count: { _all: number } }>) {
        if (g.severity in bySeverity) bySeverity[g.severity as keyof typeof bySeverity] = g._count._all;
    }
    const top = [...critical, ...warning].slice(0, TOP_ALERTS);
    const names = await tenantNames(prisma, top.map((a: any) => a.tenantId));
    return {
        bySeverity,
        total: bySeverity.critical + bySeverity.warning + bySeverity.info,
        top: top.map((a: any) => ({
            id: a.id, tenantId: a.tenantId, tenantName: a.tenantId ? (names.get(a.tenantId) ?? null) : null,
            kind: a.kind, severity: a.severity, message: a.message, count: a.count, lastSeenAt: a.lastSeenAt,
        })),
    };
}

async function payoutsSection(prisma: any, now: Date) {
    const stuckBefore = new Date(now.getTime() - STUCK_PAYOUT_MS);
    const [failed, stuck, items] = await Promise.all([
        prisma.payoutRequest.count({ where: { status: 'FAILED' } }),
        prisma.payoutRequest.count({ where: { status: { in: ['REQUESTED', 'PROCESSING'] }, updatedAt: { lt: stuckBefore } } }),
        prisma.payoutRequest.findMany({
            where: { OR: [{ status: 'FAILED' }, { status: { in: ['REQUESTED', 'PROCESSING'] }, updatedAt: { lt: stuckBefore } }] },
            orderBy: { updatedAt: 'desc' },
            take: LIST,
            select: { id: true, tenantId: true, amountMinor: true, currency: true, status: true, failureReason: true, updatedAt: true },
        }),
    ]);
    const names = await tenantNames(prisma, items.map((i: any) => i.tenantId));
    return { failed, stuck, items: items.map((i: any) => ({ ...i, tenantName: names.get(i.tenantId) ?? null })) };
}

async function refundsSection(prisma: any) {
    const where = { depositState: 'REFUND_PENDING' };
    const [pending, items] = await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
            where, orderBy: { refundNextAttemptAt: 'asc' }, take: LIST,
            select: { id: true, tenantId: true, refundAttempts: true, refundLastError: true, refundNextAttemptAt: true },
        }),
    ]);
    const names = await tenantNames(prisma, items.map((i: any) => i.tenantId));
    return {
        pending,
        items: items.map((b: any) => ({
            bookingId: b.id, tenantId: b.tenantId, tenantName: names.get(b.tenantId) ?? null,
            attempts: b.refundAttempts, lastError: b.refundLastError, nextAttemptAt: b.refundNextAttemptAt,
        })),
    };
}

async function whatsappSection(prisma: any) {
    const [notLiveRows, templateRows] = await Promise.all([
        prisma.tenant.findMany({
            where: {
                isActive: true,
                whatsappPhoneNumberId: { not: null },
                OR: [
                    { whatsappHosted: true, OR: [{ whatsappNumberStatus: null }, { whatsappNumberStatus: { not: 'REGISTERED' } }] },
                    { whatsappHosted: false, whatsappAccessToken: null },
                ],
            },
            select: { id: true, name: true, whatsappHosted: true, whatsappNumberStatus: true, whatsappDisplayNumber: true },
            take: LIST,
        }),
        prisma.messageTemplate.findMany({
            where: { isApproved: false, tenant: { isActive: true } },
            select: { tenantId: true, purpose: true, name: true, tenant: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            take: 100,
        }),
    ]);
    const byTenant = new Map<string, { tenantId: string; tenantName: string; count: number; purposes: string[] }>();
    for (const t of templateRows) {
        const e: { tenantId: string; tenantName: string; count: number; purposes: string[] } =
            byTenant.get(t.tenantId) ?? { tenantId: t.tenantId, tenantName: t.tenant?.name ?? t.tenantId, count: 0, purposes: [] };
        e.count += 1;
        e.purposes.push(t.purpose);
        byTenant.set(t.tenantId, e);
    }
    return {
        notLive: notLiveRows.map((t: any) => ({
            tenantId: t.id, tenantName: t.name, displayNumber: t.whatsappDisplayNumber ?? null,
            reason: t.whatsappHosted ? 'Number is added but not yet verified with Meta' : 'No access token: the tenant needs to reconnect WhatsApp',
        })),
        unapprovedTemplates: [...byTenant.values()].slice(0, LIST),
    };
}

async function quotaSection(prisma: any, percent: number, now: Date) {
    const tenants: Array<{ id: string; name: string; planId: string; quotaCycleStart: Date | null; createdAt: Date; monthlyMessageQuotaOverride: number | null }> =
        await prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, name: true, planId: true, quotaCycleStart: true, createdAt: true, monthlyMessageQuotaOverride: true },
            orderBy: { createdAt: 'desc' },
            take: QUOTA_SCAN,
        });
    const used = await messagesThisCycleByTenant(prisma, tenants, now);
    const near = tenants
        .map((t) => {
            const limit = effectiveMessageQuota(getPlan(t.planId), t.monthlyMessageQuotaOverride);
            const u = used.get(t.id) ?? 0;
            return { tenantId: t.id, tenantName: t.name, planId: t.planId, used: u, limit, percent: limit > 0 ? Math.floor((u / limit) * 100) : 100 };
        })
        .filter((t) => t.percent >= percent)
        .sort((a, b) => b.percent - a.percent)
        .slice(0, LIST);
    return { thresholdPercent: percent, nearLimit: near, scanned: tenants.length, truncated: tenants.length >= QUOTA_SCAN };
}

async function handoffsSection(prisma: any, minutes: number, now: Date) {
    const cutoff = new Date(now.getTime() - minutes * 60_000);
    const candidates: Array<any> = await prisma.conversation.findMany({
        where: { state: 'HUMAN_ACTIVE', takeoverAt: { lte: cutoff } },
        orderBy: { takeoverAt: 'asc' },
        take: HANDOFF_CANDIDATES,
        select: { id: true, tenantId: true, customerName: true, customerPhone: true, takeoverAt: true, takeoverReason: true },
    });
    if (candidates.length === 0) return { olderThanMinutes: minutes, count: 0, items: [], capped: false };
    // "Answered" = an OUTBOUND message after the handoff. The bot's own earlier
    // messages predate takeoverAt, so only a later reply counts.
    const lastOut: Array<{ conversationId: string; _max: { createdAt: Date | null } }> = await prisma.message.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: candidates.map((c) => c.id) }, direction: 'OUTBOUND' },
        _max: { createdAt: true },
    });
    const lastOutAt = new Map(lastOut.map((r) => [r.conversationId, r._max.createdAt]));
    const unanswered = candidates.filter((c) => {
        const out = lastOutAt.get(c.id);
        return !out || out.getTime() <= c.takeoverAt.getTime();
    });
    const shown = unanswered.slice(0, LIST);
    const names = await tenantNames(prisma, shown.map((c) => c.tenantId));
    return {
        olderThanMinutes: minutes,
        count: unanswered.length,
        capped: candidates.length >= HANDOFF_CANDIDATES,
        items: shown.map((c) => ({
            conversationId: c.id, tenantId: c.tenantId, tenantName: names.get(c.tenantId) ?? null,
            customer: c.customerName ?? maskPhone(c.customerPhone) ?? 'Unknown',
            waitingMinutes: Math.floor((now.getTime() - c.takeoverAt.getTime()) / 60_000),
            reason: c.takeoverReason,
        })),
    };
}

async function webhooksSection(prisma: any, now: Date) {
    const since = new Date(now.getTime() - DAY_MS);
    const where = { status: 'FAILED', createdAt: { gte: since } };
    const [total, groups] = await Promise.all([
        prisma.webhookDelivery.count({ where }),
        prisma.webhookDelivery.groupBy({ by: ['tenantId'], where, _count: { _all: true }, orderBy: { _count: { tenantId: 'desc' } }, take: LIST }),
    ]);
    const names = await tenantNames(prisma, groups.map((g: any) => g.tenantId));
    return {
        failedLast24h: total,
        byTenant: groups.map((g: any) => ({ tenantId: g.tenantId, tenantName: names.get(g.tenantId) ?? null, count: g._count._all })),
    };
}

export async function buildAttention(prisma: any, opts: AttentionOptions) {
    const now = opts.now ?? new Date();
    const [alerts, payouts, refunds, whatsapp, quota, handoffs, webhooks] = await Promise.all([
        section('alerts', () => alertsSection(prisma)),
        opts.includeMoney ? section('payouts', () => payoutsSection(prisma, now)) : Promise.resolve(null),
        opts.includeMoney ? section('refunds', () => refundsSection(prisma)) : Promise.resolve(null),
        section('whatsapp', () => whatsappSection(prisma)),
        section('quota', () => quotaSection(prisma, opts.quotaPercent, now)),
        section('handoffs', () => handoffsSection(prisma, opts.handoffMinutes, now)),
        section('webhooks', () => webhooksSection(prisma, now)),
    ]);
    return { generatedAt: now.toISOString(), alerts, payouts, refunds, whatsapp, quota, handoffs, webhooks };
}

const attentionRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/attention
    fastify.get('/attention', { preHandler: adminGuard(fastify, 'attention:read') }, async (request) => {
        const q = attentionQuerySchema.parse(request.query);
        return buildAttention(fastify.prisma, { ...q, includeMoney: can(request.admin!.role, 'money:read') });
    });
};

export default attentionRoutes;
