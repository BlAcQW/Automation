/**
 * Organisation detail (A3): everything support needs about one tenant on one
 * page, read-only. Secrets never leave this file: credential columns are
 * selected only to answer "is it set up?" and are returned as booleans.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { can } from '../../services/admin-permissions.js';
import { selectCredentialSource } from '../../services/whatsapp-credentials.js';
import { effectiveMessageQuota, getPlan } from '../../services/plans.js';
import { currentCycleEnd, currentCycleKey, currentCycleStart } from '../../services/usage.js';
import { maskPhone } from './attention.js';
import { adminGuard } from './guard.js';

export type ChecklistStatus = 'done' | 'todo' | 'na';
export interface ChecklistItem {
    key: 'whatsapp' | 'paystack' | 'sms' | 'email' | 'templates' | 'external_app' | 'flow';
    label: string;
    status: ChecklistStatus;
    detail?: string;
}

export interface ChecklistInputs {
    templates: { total: number; approved: number };
    hasExternalApp: boolean;
    externalAppActive: boolean;
    activeFlowDefinitionCount: number;
    payoutRecipients: number;
}

interface ChecklistTenant {
    whatsappPhoneNumberId: string | null;
    whatsappAccessToken: string | null;
    whatsappHosted: boolean;
    whatsappNumberStatus: string | null;
    paystackSecretKey: string | null;
    arkeselApiKey: string | null;
    gmailUser: string | null;
    gmailAppPassword: string | null;
    conversationMode: string | null;
    activeFlowKey: string | null;
}

const item = (key: ChecklistItem['key'], label: string, status: ChecklistStatus, detail?: string): ChecklistItem =>
    ({ key, label, status, ...(detail ? { detail } : {}) });

/** Pure: which setup steps are done. Booleans only; no credential value is ever returned. */
export function buildChecklist(t: ChecklistTenant, i: ChecklistInputs): ChecklistItem[] {
    const wa = selectCredentialSource(t);
    const whatsappDetail = wa
        ? wa.kind === 'hosted' ? 'Bookly-hosted number, verified' : 'Own number connected'
        : t.whatsappHosted && t.whatsappPhoneNumberId ? 'Hosted number added, not yet verified with Meta' : 'Not connected';

    const paystackDetail = t.paystackSecretKey ? 'Own Paystack key' : i.payoutRecipients > 0 ? 'Collects through Bookly; payout destination set' : 'No own key and no payout destination';
    const paystackDone = !!t.paystackSecretKey || i.payoutRecipients > 0;

    const platformSms = !!config.platformSms?.apiKey;
    const smsDone = !!t.arkeselApiKey || platformSms;
    const smsDetail = t.arkeselApiKey ? 'Own Arkesel key' : platformSms ? 'Using platform SMS (budgeted)' : 'No SMS route';

    const ownEmail = !!(t.gmailUser && t.gmailAppPassword);
    const platformEmail = !!(config.platformGmail?.user && config.platformGmail?.appPassword);
    const emailDone = ownEmail || platformEmail;

    const mode = t.conversationMode;
    const external: ChecklistItem = mode === 'external'
        ? item('external_app', 'External app', i.hasExternalApp && i.externalAppActive ? 'done' : 'todo',
            !i.hasExternalApp ? 'No external app registered' : i.externalAppActive ? 'Active' : 'Registered but switched off')
        : item('external_app', 'External app', 'na', 'Not in external mode');
    const flow: ChecklistItem = mode === 'flow'
        ? item('flow', 'Workflow', t.activeFlowKey && i.activeFlowDefinitionCount > 0 ? 'done' : 'todo',
            !t.activeFlowKey ? 'No workflow selected' : i.activeFlowDefinitionCount > 0 ? `Running "${t.activeFlowKey}"` : `"${t.activeFlowKey}" has no active version`)
        : item('flow', 'Workflow', 'na', 'Not in workflow mode');

    return [
        item('whatsapp', 'WhatsApp', wa ? 'done' : 'todo', whatsappDetail),
        item('paystack', 'Payments (Paystack)', paystackDone ? 'done' : 'todo', paystackDetail),
        item('sms', 'SMS fallback', smsDone ? 'done' : 'todo', smsDetail),
        item('email', 'Email fallback', emailDone ? 'done' : 'todo', ownEmail ? 'Own Gmail' : platformEmail ? 'Using platform email' : 'No email route'),
        item('templates', 'WhatsApp templates', i.templates.approved > 0 ? 'done' : 'todo', `${i.templates.approved} of ${i.templates.total} approved`),
        external,
        flow,
    ];
}

const idParam = z.object({ id: z.string().min(1).max(64) });
const LIST = 20;

const organisationRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/tenants/:id/overview
    fastify.get('/tenants/:id/overview', { preHandler: adminGuard(fastify, 'tenants:read') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const prisma = fastify.prisma;
        const includeMoney = can(request.admin!.role, 'money:read');

        const t: any = await prisma.tenant.findUnique({
            where: { id },
            select: {
                id: true, name: true, vertical: true, businessType: true, timezone: true, isActive: true, createdAt: true,
                planId: true, subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true,
                quotaCycleStart: true, monthlyMessageQuotaOverride: true, paymentCurrency: true,
                conversationMode: true, activeFlowKey: true,
                whatsappPhoneNumberId: true, whatsappAccessToken: true, whatsappHosted: true,
                whatsappNumberStatus: true, whatsappDisplayNumber: true,
                paystackSecretKey: true, arkeselApiKey: true, gmailUser: true, gmailAppPassword: true,
                outboundPausedAt: true, payoutsPausedAt: true, pauseReason: true, deletionRequestedAt: true,
            },
        });
        if (!t) throw fastify.httpErrors.notFound('Organisation not found');

        const [templateGroups, externalApp, activeFlows, recipients, staff, usage, usedRow, conversations, audit, sessions, money] = await Promise.all([
            prisma.messageTemplate.groupBy({ by: ['isApproved'], where: { tenantId: id }, _count: { _all: true } }),
            prisma.externalApp.findUnique({ where: { tenantId: id }, select: { isActive: true } }),
            t.activeFlowKey
                ? prisma.flowDefinition.count({ where: { tenantId: id, key: t.activeFlowKey, isActive: true } })
                : Promise.resolve(0),
            prisma.payoutRecipient.count({ where: { tenantId: id, archivedAt: null } }),
            prisma.user.findMany({
                where: { tenantId: id }, orderBy: { createdAt: 'asc' }, take: 100,
                select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
            }),
            prisma.tenantUsage.findMany({
                where: { tenantId: id }, orderBy: { month: 'desc' }, take: 6,
                select: { month: true, messageCount: true, platformSmsCount: true },
            }),
            prisma.tenantUsage.findUnique({
                where: { tenantId_month: { tenantId: id, month: currentCycleKey(t) } },
                select: { messageCount: true },
            }),
            prisma.conversation.findMany({
                where: { tenantId: id }, orderBy: { updatedAt: 'desc' }, take: 10,
                select: { id: true, channel: true, customerName: true, customerPhone: true, state: true, lastInboundAt: true },
            }),
            prisma.auditLog.findMany({
                where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: LIST,
                select: { id: true, action: true, actorType: true, actorId: true, createdAt: true, metadata: true },
            }),
            prisma.supportSession.findMany({
                where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 5,
                select: { id: true, adminId: true, reason: true, mode: true, createdAt: true, expiresAt: true, endedAt: true },
            }),
            includeMoney ? moneySummary(prisma, id) : Promise.resolve(null),
        ]);

        const approved = templateGroups.find((g: any) => g.isApproved)?._count._all ?? 0;
        const unapproved = templateGroups.find((g: any) => !g.isApproved)?._count._all ?? 0;
        const limit = effectiveMessageQuota(getPlan(t.planId), t.monthlyMessageQuotaOverride);
        const used = usedRow?.messageCount ?? 0;

        return {
            tenant: {
                id: t.id, name: t.name, vertical: t.vertical, businessType: t.businessType, timezone: t.timezone,
                isActive: t.isActive, createdAt: t.createdAt, paymentCurrency: t.paymentCurrency,
                conversationMode: t.conversationMode, activeFlowKey: t.activeFlowKey,
                planId: t.planId, subscriptionStatus: t.subscriptionStatus, trialEndsAt: t.trialEndsAt, currentPeriodEnd: t.currentPeriodEnd,
                whatsappDisplayNumber: t.whatsappDisplayNumber, deletionRequestedAt: t.deletionRequestedAt,
            },
            checklist: buildChecklist(t, {
                templates: { total: approved + unapproved, approved },
                hasExternalApp: !!externalApp,
                externalAppActive: !!externalApp?.isActive,
                activeFlowDefinitionCount: activeFlows,
                payoutRecipients: recipients,
            }),
            plan: {
                planId: t.planId, limit, used, percent: limit > 0 ? Math.floor((used / limit) * 100) : 100,
                overridden: t.monthlyMessageQuotaOverride !== null,
                cycleStart: currentCycleStart(t), cycleEnd: currentCycleEnd(t),
            },
            switches: {
                outbound: { pausedAt: t.outboundPausedAt },
                payouts: { pausedAt: t.payoutsPausedAt },
                reason: t.pauseReason,
            },
            staff,
            usage: usage.map((u: any) => ({ cycle: u.month, messages: u.messageCount, platformSms: u.platformSmsCount })),
            money,
            recentConversations: conversations.map((c: any) => ({
                id: c.id, channel: c.channel, customerName: c.customerName, customer: maskPhone(c.customerPhone),
                state: c.state, lastInboundAt: c.lastInboundAt,
            })),
            audit,
            supportSessions: sessions,
        };
    });
};

async function moneySummary(prisma: any, tenantId: string) {
    const [wallet, byStatus, recent, refundsPending] = await Promise.all([
        prisma.wallet.findUnique({ where: { tenantId }, select: { currency: true, cachedAvailableMinor: true, cachedPendingMinor: true } }),
        prisma.payoutRequest.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true }, _sum: { amountMinor: true } }),
        prisma.payoutRequest.findMany({
            where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 5,
            select: { id: true, amountMinor: true, currency: true, status: true, failureReason: true, createdAt: true },
        }),
        prisma.booking.count({ where: { tenantId, depositState: 'REFUND_PENDING' } }),
    ]);
    return {
        wallet: wallet ? { currency: wallet.currency, availableMinor: wallet.cachedAvailableMinor, pendingMinor: wallet.cachedPendingMinor } : null,
        payoutsByStatus: byStatus.map((g: any) => ({ status: g.status, count: g._count._all, totalMinor: g._sum.amountMinor ?? 0 })),
        recentPayouts: recent,
        refundsPending,
    };
}

export default organisationRoutes;
