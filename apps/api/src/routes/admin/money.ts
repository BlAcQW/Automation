/**
 * Money oversight (A3). STRICTLY READ-ONLY: this plugin registers GET routes
 * only. Moving money stays in the money routes, behind their own rules.
 *
 * Balances come from the wallets' cached figures (one row per tenant, cheap);
 * the ledger remains the source of truth and the reconciliation job proves the
 * cache. Fees are summed from the ledger over a bounded window.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { adminGuard } from './guard.js';

const FEE_WINDOW_DAYS = 30;
const REFUND_STATES = ['REFUND_PENDING', 'REFUNDING', 'REFUNDED'] as const;
const PAYOUT_STATUSES = ['REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const;

export async function buildMoneyOverview(prisma: any, now: Date = new Date()) {
    const feeSince = new Date(now.getTime() - FEE_WINDOW_DAYS * 86_400_000);
    const [wallets, payouts, refunds, fees] = await Promise.all([
        prisma.wallet.groupBy({ by: ['currency'], _sum: { cachedAvailableMinor: true, cachedPendingMinor: true }, _count: { _all: true } }),
        prisma.payoutRequest.groupBy({ by: ['status', 'currency'], _count: { _all: true }, _sum: { amountMinor: true } }),
        prisma.booking.groupBy({ by: ['depositState'], where: { depositState: { in: [...REFUND_STATES] } }, _count: { _all: true } }),
        prisma.ledgerEntry.groupBy({ by: ['currency'], where: { account: 'PLATFORM_FEE', createdAt: { gte: feeSince } }, _sum: { amountMinor: true } }),
    ]);
    const refundCount = (state: string) => refunds.find((r: any) => r.depositState === state)?._count._all ?? 0;
    return {
        generatedAt: now.toISOString(),
        balances: wallets.map((w: any) => ({
            currency: w.currency,
            availableMinor: w._sum.cachedAvailableMinor ?? 0,
            pendingMinor: w._sum.cachedPendingMinor ?? 0,
            wallets: w._count._all,
        })),
        payouts: payouts.map((p: any) => ({ status: p.status, currency: p.currency, count: p._count._all, totalMinor: p._sum.amountMinor ?? 0 })),
        refunds: { pending: refundCount('REFUND_PENDING'), refunding: refundCount('REFUNDING'), refunded: refundCount('REFUNDED') },
        fees: { windowDays: FEE_WINDOW_DAYS, byCurrency: fees.map((f: any) => ({ currency: f.currency, totalMinor: f._sum.amountMinor ?? 0 })) },
        note: 'Balances are the wallets\' cached figures; the ledger is the source of truth and is reconciled separately. Amounts are minor units.',
    };
}

const pageQuery = {
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
};
const payoutsQuery = z.object({
    ...pageQuery,
    status: z.enum(PAYOUT_STATUSES).optional(),
    tenantId: z.string().min(1).max(64).optional(),
});
const refundsQuery = z.object({
    ...pageQuery,
    state: z.enum(['pending', 'refunding', 'refunded']).default('pending'),
    tenantId: z.string().min(1).max(64).optional(),
});
const STATE_OF = { pending: 'REFUND_PENDING', refunding: 'REFUNDING', refunded: 'REFUNDED' } as const;

async function namesFor(prisma: any, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await prisma.tenant.findMany({ where: { id: { in: unique } }, select: { id: true, name: true }, take: unique.length });
    return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
}

const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

const moneyRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/money/overview
    fastify.get('/money/overview', { preHandler: adminGuard(fastify, 'money:read') }, async () =>
        buildMoneyOverview(fastify.prisma));

    // GET /admin/money/payouts
    fastify.get('/money/payouts', { preHandler: adminGuard(fastify, 'money:read') }, async (request) => {
        const q = payoutsQuery.parse(request.query);
        const where = { ...(q.status ? { status: q.status } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}) };
        const [total, rows] = await Promise.all([
            fastify.prisma.payoutRequest.count({ where }),
            fastify.prisma.payoutRequest.findMany({
                where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
                select: {
                    id: true, tenantId: true, amountMinor: true, currency: true, status: true, failureReason: true,
                    providerRef: true, createdAt: true, updatedAt: true, settledAt: true,
                    // Masked display fields only: never the encrypted account number.
                    recipient: { select: { accountName: true, accountNumberMasked: true, type: true, bankCode: true } },
                },
            }),
        ]);
        const names = await namesFor(fastify.prisma, rows.map((r) => r.tenantId));
        return { data: rows.map((r) => ({ ...r, tenantName: names.get(r.tenantId) ?? null })), pagination: pagination(q.page, q.limit, total) };
    });

    // GET /admin/money/refunds
    fastify.get('/money/refunds', { preHandler: adminGuard(fastify, 'money:read') }, async (request) => {
        const q = refundsQuery.parse(request.query);
        const where = { depositState: STATE_OF[q.state], ...(q.tenantId ? { tenantId: q.tenantId } : {}) };
        const [total, rows] = await Promise.all([
            fastify.prisma.booking.count({ where }),
            fastify.prisma.booking.findMany({
                where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
                // No customer name/phone: money oversight does not need them.
                select: {
                    id: true, tenantId: true, bookingReference: true, depositAmount: true, depositState: true,
                    refundAttempts: true, refundLastError: true, refundNextAttemptAt: true, updatedAt: true,
                },
            }),
        ]);
        const names = await namesFor(fastify.prisma, rows.map((r) => r.tenantId));
        return {
            data: rows.map((b) => ({
                bookingId: b.id, tenantId: b.tenantId, tenantName: names.get(b.tenantId) ?? null, reference: b.bookingReference,
                amount: b.depositAmount, state: b.depositState, attempts: b.refundAttempts, lastError: b.refundLastError,
                nextAttemptAt: b.refundNextAttemptAt, updatedAt: b.updatedAt,
            })),
            pagination: pagination(q.page, q.limit, total),
        };
    });
};

export default moneyRoutes;
