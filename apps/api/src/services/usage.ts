/**
 * Per-tenant monthly outbound-message usage helpers (Phase 4a).
 *
 * - `currentMonthKey`: formats a Date as "YYYY-MM" UTC.
 * - `getQuotaState`: reads the current month's TenantUsage row and compares
 *   against the plan's monthlyMessageQuota.
 * - `incrementMessageUsage`: atomic upsert. Use AFTER a successful send.
 * - `checkOutboundQuota`: convenience that loads tenant.planId + evaluates.
 *
 * Both helpers are safe to call from the BullMQ worker, the bot, and
 * authenticated HTTP routes — the Prisma `$extends` tenant guard skips when
 * the call originates from the worker (no tenant context) and is satisfied
 * by the explicit `tenantId` filter otherwise.
 */

import type { PrismaClient, SubscriptionStatus } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { getPlan, type Plan } from './plans.js';

// The worker and the API use slightly different Prisma client types (raw vs
// `$extends`-wrapped). Both expose the same methods we need here, so accept
// either.
export type AnyPrismaClient = PrismaClient | ExtendedPrismaClient;

// Phase 4b — grace period between PAST_DUE and auto-downgrade to Free.
const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function currentMonthKey(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface QuotaState {
    ok: boolean;
    used: number;
    limit: number;
    planId: string;
}

export async function getQuotaState(
    prisma: AnyPrismaClient,
    tenantId: string,
    planId: string | null | undefined,
): Promise<QuotaState> {
    const plan = getPlan(planId);
    const row = await prisma.tenantUsage.findUnique({
        where: { tenantId_month: { tenantId, month: currentMonthKey() } },
        select: { messageCount: true },
    });
    const used = row?.messageCount ?? 0;
    return {
        ok: used < plan.monthlyMessageQuota,
        used,
        limit: plan.monthlyMessageQuota,
        planId: plan.id,
    };
}

export type ReserveOutcome =
    | { ok: true; used: number; limit: number; planId: string }
    | { ok: false; used: number; limit: number; planId: string };

/**
 * Atomically reserve one outbound message slot in a single SQL statement.
 *
 * - Resolves the tenant's effective plan first (so expired trials / lapsed
 *   PAST_DUE are demoted before quota check).
 * - Uses `updateMany WHERE messageCount < limit` so two parallel callers
 *   cannot both reserve when only one slot remains.
 * - Returns `ok: true` with the post-increment count when the slot was
 *   secured, or `ok: false` when the quota is full.
 *
 * Callers that successfully reserve but then fail to send (Meta 5xx, network
 * error) should call `rollbackOutboundReservation` so transient failures
 * don't burn quota.
 *
 * Use this in place of `checkOutboundQuota` + `incrementMessageUsage` —
 * those two together are not safe under concurrency.
 */
export async function tryReserveOutbound(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<ReserveOutcome> {
    const resolved = await evaluateSubscription(prisma, tenantId);
    const limit = resolved.plan.monthlyMessageQuota;
    const planId = resolved.plan.id;
    const month = currentMonthKey();

    // Ensure the row exists so updateMany can hit it. Create with count=0
    // (not 1) so the atomic increment below is the canonical counter.
    await prisma.tenantUsage.upsert({
        where: { tenantId_month: { tenantId, month } },
        create: { tenantId, month, messageCount: 0 },
        update: {},
    });

    // updateMany's WHERE doesn't accept the composite-key shortcut
    // (`tenantId_month`) that findUnique/update do — use individual fields.
    const claimed = await prisma.tenantUsage.updateMany({
        where: {
            tenantId,
            month,
            messageCount: { lt: limit },
        },
        data: { messageCount: { increment: 1 } },
    });

    const row = await prisma.tenantUsage.findUnique({
        where: { tenantId_month: { tenantId, month } },
        select: { messageCount: true },
    });
    const used = row?.messageCount ?? 0;

    if (claimed.count === 1) {
        return { ok: true, used, limit, planId };
    }
    return { ok: false, used, limit, planId };
}

/**
 * Decrement the counter after a failed send so transient failures don't
 * permanently burn quota. Use as the cleanup step when `tryReserveOutbound`
 * succeeded but the actual Meta call failed.
 *
 * Guarded with `messageCount > 0` so concurrent rollbacks never go negative.
 */
export async function rollbackOutboundReservation(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<void> {
    const month = currentMonthKey();
    await prisma.tenantUsage.updateMany({
        where: { tenantId, month, messageCount: { gt: 0 } },
        data: { messageCount: { decrement: 1 } },
    });
}

/**
 * @deprecated use `tryReserveOutbound` — the check-then-increment pair is
 * not safe under concurrency. Kept for tests that still depend on it.
 *
 * Atomically count one outbound message against the current month. Returns
 * the post-increment value. Call AFTER a successful send so transient send
 * failures don't burn quota.
 */
export async function incrementMessageUsage(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<number> {
    const month = currentMonthKey();
    const row = await prisma.tenantUsage.upsert({
        where: { tenantId_month: { tenantId, month } },
        create: { tenantId, month, messageCount: 1 },
        update: { messageCount: { increment: 1 } },
        select: { messageCount: true },
    });
    return row.messageCount;
}

/**
 * Convenience helper used by every outbound send site: resolve the tenant's
 * effective plan (running the subscription evaluator first so an expired
 * trial or lapsed PAST_DUE has been demoted before we count quota) and then
 * evaluate the monthly message quota.
 */
export async function checkOutboundQuota(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<QuotaState> {
    const resolved = await evaluateSubscription(prisma, tenantId);
    return getQuotaState(prisma, tenantId, resolved.plan.id);
}

export interface ResolvedPlan {
    plan: Plan;
    status: SubscriptionStatus | null;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
}

/**
 * Read tenant subscription state and, if a deadline has lapsed, demote to
 * Free + CANCELLED. Returns the post-evaluation plan so callers don't need
 * a second query.
 *
 * Lazy: only writes when state actually changes. The two transitions are:
 *   - TRIALING + trialEndsAt < now            → Free / CANCELLED
 *   - PAST_DUE + currentPeriodEnd + 7d < now  → Free / CANCELLED
 *
 * Returns a safe default (Free / null) when the tenant is missing.
 */
export async function evaluateSubscription(
    prisma: AnyPrismaClient,
    tenantId: string,
): Promise<ResolvedPlan> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
            planId: true,
            subscriptionStatus: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
        },
    });
    if (!tenant) {
        return { plan: getPlan('free'), status: null, trialEndsAt: null, currentPeriodEnd: null };
    }

    const now = Date.now();
    const status = tenant.subscriptionStatus;
    const trialExpired =
        status === 'TRIALING' &&
        tenant.trialEndsAt &&
        tenant.trialEndsAt.getTime() < now;
    const pastDueLapsed =
        status === 'PAST_DUE' &&
        tenant.currentPeriodEnd &&
        tenant.currentPeriodEnd.getTime() + PAST_DUE_GRACE_MS < now;

    if (trialExpired || pastDueLapsed) {
        await prisma.tenant.update({
            where: { id: tenantId },
            data: {
                planId: 'free',
                subscriptionStatus: 'CANCELLED',
            },
        });
        return {
            plan: getPlan('free'),
            status: 'CANCELLED',
            trialEndsAt: tenant.trialEndsAt,
            currentPeriodEnd: tenant.currentPeriodEnd,
        };
    }

    return {
        plan: getPlan(tenant.planId),
        status,
        trialEndsAt: tenant.trialEndsAt,
        currentPeriodEnd: tenant.currentPeriodEnd,
    };
}
