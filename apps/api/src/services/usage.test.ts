import { describe, it, expect, vi } from 'vitest';
import {
    currentMonthKey,
    getQuotaState,
    incrementMessageUsage,
    checkOutboundQuota,
    evaluateSubscription,
} from './usage';
import { getPlan, PLAN_CATALOG } from './plans';

describe('currentMonthKey', () => {
    it('formats a Date as YYYY-MM in UTC', () => {
        // Construct in UTC explicitly so the assertion is timezone-stable.
        const d = new Date(Date.UTC(2026, 4, 12, 23, 59));
        expect(currentMonthKey(d)).toBe('2026-05');
    });

    it('pads single-digit months', () => {
        const d = new Date(Date.UTC(2026, 0, 1));
        expect(currentMonthKey(d)).toBe('2026-01');
    });
});

describe('getPlan', () => {
    it('returns Free for null / undefined / unknown ids', () => {
        expect(getPlan(null).id).toBe('free');
        expect(getPlan(undefined).id).toBe('free');
        expect(getPlan('nonexistent').id).toBe('free');
        expect(getPlan('').id).toBe('free');
    });

    it('returns the right plan for known ids', () => {
        expect(getPlan('starter').id).toBe('starter');
        expect(getPlan('pro').id).toBe('pro');
        expect(getPlan('pro').monthlyMessageQuota).toBe(PLAN_CATALOG.pro.monthlyMessageQuota);
    });
});

describe('getQuotaState', () => {
    function makePrisma(messageCount: number | null) {
        return {
            tenantUsage: {
                findUnique: vi.fn().mockResolvedValue(
                    messageCount === null ? null : { messageCount },
                ),
            },
        } as any;
    }

    it('returns ok=true when used below the limit', async () => {
        const prisma = makePrisma(49);
        const state = await getQuotaState(prisma, 't1', 'free');
        expect(state).toMatchObject({ ok: true, used: 49, limit: 50, planId: 'free' });
    });

    it('returns ok=false at the limit (50/50)', async () => {
        const prisma = makePrisma(50);
        const state = await getQuotaState(prisma, 't1', 'free');
        expect(state.ok).toBe(false);
        expect(state.used).toBe(50);
        expect(state.limit).toBe(50);
    });

    it('treats missing usage row as 0', async () => {
        const prisma = makePrisma(null);
        const state = await getQuotaState(prisma, 't1', 'free');
        expect(state).toMatchObject({ ok: true, used: 0, limit: 50 });
    });

    it('uses the Free quota when planId is unknown', async () => {
        const prisma = makePrisma(0);
        const state = await getQuotaState(prisma, 't1', 'mystery-plan');
        expect(state.planId).toBe('free');
        expect(state.limit).toBe(PLAN_CATALOG.free.monthlyMessageQuota);
    });
});

describe('incrementMessageUsage', () => {
    it('upserts the row with increment: 1', async () => {
        const upsert = vi.fn().mockResolvedValue({ messageCount: 7 });
        const prisma = { tenantUsage: { upsert } } as any;

        const next = await incrementMessageUsage(prisma, 'tenant-x');
        expect(next).toBe(7);

        const arg = upsert.mock.calls[0][0];
        expect(arg.where).toEqual({
            tenantId_month: { tenantId: 'tenant-x', month: currentMonthKey() },
        });
        expect(arg.create).toMatchObject({ tenantId: 'tenant-x', messageCount: 1 });
        expect(arg.update).toEqual({ messageCount: { increment: 1 } });
    });
});

describe('checkOutboundQuota', () => {
    it('loads the tenant planId and resolves quota', async () => {
        const prisma = {
            tenant: {
                findUnique: vi.fn().mockResolvedValue({
                    planId: 'starter',
                    subscriptionStatus: 'ACTIVE',
                    trialEndsAt: null,
                    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000),
                }),
                update: vi.fn(),
            },
            tenantUsage: {
                findUnique: vi.fn().mockResolvedValue({ messageCount: 100 }),
            },
        } as any;

        const state = await checkOutboundQuota(prisma, 't1');
        expect(state).toMatchObject({
            ok: true,
            used: 100,
            limit: PLAN_CATALOG.starter.monthlyMessageQuota,
            planId: 'starter',
        });
    });

    it('falls back to Free when the tenant is missing', async () => {
        const prisma = {
            tenant: {
                findUnique: vi.fn().mockResolvedValue(null),
                update: vi.fn(),
            },
            tenantUsage: {
                findUnique: vi.fn().mockResolvedValue(null),
            },
        } as any;

        const state = await checkOutboundQuota(prisma, 't1');
        expect(state.planId).toBe('free');
        expect(state.limit).toBe(PLAN_CATALOG.free.monthlyMessageQuota);
    });
});

describe('evaluateSubscription (Phase 4b)', () => {
    function makePrisma(tenant: any) {
        return {
            tenant: {
                findUnique: vi.fn().mockResolvedValue(tenant),
                update: vi.fn().mockResolvedValue(tenant),
            },
        } as any;
    }

    it('demotes to Free + CANCELLED when TRIALING and trial has expired', async () => {
        const prisma = makePrisma({
            planId: 'pro',
            subscriptionStatus: 'TRIALING',
            trialEndsAt: new Date(Date.now() - 24 * 60 * 60_000), // yesterday
            currentPeriodEnd: null,
        });

        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.plan.id).toBe('free');
        expect(resolved.status).toBe('CANCELLED');
        expect(prisma.tenant.update).toHaveBeenCalledWith({
            where: { id: 't1' },
            data: { planId: 'free', subscriptionStatus: 'CANCELLED' },
        });
    });

    it('keeps Pro for an active trial', async () => {
        const prisma = makePrisma({
            planId: 'pro',
            subscriptionStatus: 'TRIALING',
            trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
            currentPeriodEnd: null,
        });

        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.plan.id).toBe('pro');
        expect(resolved.status).toBe('TRIALING');
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('demotes PAST_DUE to Free + CANCELLED after the 7-day grace', async () => {
        const prisma = makePrisma({
            planId: 'pro',
            subscriptionStatus: 'PAST_DUE',
            trialEndsAt: null,
            currentPeriodEnd: new Date(Date.now() - 8 * 24 * 60 * 60_000), // 8 days ago
        });

        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.plan.id).toBe('free');
        expect(resolved.status).toBe('CANCELLED');
        expect(prisma.tenant.update).toHaveBeenCalled();
    });

    it('keeps the paid plan for PAST_DUE within the grace window', async () => {
        const prisma = makePrisma({
            planId: 'starter',
            subscriptionStatus: 'PAST_DUE',
            trialEndsAt: null,
            currentPeriodEnd: new Date(Date.now() - 2 * 24 * 60 * 60_000), // 2 days ago
        });

        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.plan.id).toBe('starter');
        expect(resolved.status).toBe('PAST_DUE');
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('passes ACTIVE tenants through untouched', async () => {
        const prisma = makePrisma({
            planId: 'starter',
            subscriptionStatus: 'ACTIVE',
            trialEndsAt: null,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        });

        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.plan.id).toBe('starter');
        expect(resolved.status).toBe('ACTIVE');
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('returns Free + null status for tenants that predate Phase 4b', async () => {
        const prisma = makePrisma({
            planId: 'free',
            subscriptionStatus: null,
            trialEndsAt: null,
            currentPeriodEnd: null,
        });

        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.plan.id).toBe('free');
        expect(resolved.status).toBeNull();
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });
});
