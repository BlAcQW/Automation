import { describe, it, expect, vi } from 'vitest';
import {
    currentMonthKey,
    currentCycleStart,
    currentCycleEnd,
    currentCycleKey,
    getQuotaState,
    incrementMessageUsage,
    checkOutboundQuota,
    evaluateSubscription,
} from './usage';
import { getPlan, PLAN_CATALOG } from './plans';

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_MS = 30 * DAY_MS;

describe('currentMonthKey (legacy)', () => {
    it('formats a Date as YYYY-MM in UTC', () => {
        const d = new Date(Date.UTC(2026, 4, 12, 23, 59));
        expect(currentMonthKey(d)).toBe('2026-05');
    });

    it('pads single-digit months', () => {
        const d = new Date(Date.UTC(2026, 0, 1));
        expect(currentMonthKey(d)).toBe('2026-01');
    });
});

describe('per-tenant cycle helpers (Phase 4c)', () => {
    it('cycleStart equals the anchor inside the first 30 days', () => {
        const anchor = new Date('2026-05-12T10:00:00Z');
        const now = new Date('2026-05-25T00:00:00Z'); // 13 days in
        const tenant = { quotaCycleStart: anchor, createdAt: anchor };
        expect(currentCycleStart(tenant, now).toISOString()).toBe(anchor.toISOString());
        expect(currentCycleKey(tenant, now)).toBe('2026-05-12');
    });

    it('rolls forward when 30 days have elapsed', () => {
        const anchor = new Date('2026-05-12T10:00:00Z');
        const now = new Date(anchor.getTime() + 31 * DAY_MS); // 31 days later
        const tenant = { quotaCycleStart: anchor, createdAt: anchor };
        const expectedStart = new Date(anchor.getTime() + CYCLE_MS);
        expect(currentCycleStart(tenant, now).toISOString()).toBe(expectedStart.toISOString());
    });

    it('rolls forward exactly N cycles when many cycles have elapsed', () => {
        const anchor = new Date('2026-01-01T00:00:00Z');
        const now = new Date(anchor.getTime() + 95 * DAY_MS); // 3 complete cycles + 5 days
        const tenant = { quotaCycleStart: anchor, createdAt: anchor };
        const expectedStart = new Date(anchor.getTime() + 3 * CYCLE_MS);
        expect(currentCycleStart(tenant, now).toISOString()).toBe(expectedStart.toISOString());
    });

    it('cycleEnd is start + 30 days', () => {
        const anchor = new Date('2026-05-12T10:00:00Z');
        const tenant = { quotaCycleStart: anchor, createdAt: anchor };
        const end = currentCycleEnd(tenant, anchor);
        expect(end.getTime() - anchor.getTime()).toBe(CYCLE_MS);
    });

    it('falls back to createdAt when quotaCycleStart is null', () => {
        const createdAt = new Date('2026-05-01T10:00:00Z');
        const tenant = { quotaCycleStart: null, createdAt };
        expect(currentCycleKey(tenant, createdAt)).toBe('2026-05-01');
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
        const now = new Date();
        return {
            tenant: {
                findUnique: vi.fn().mockResolvedValue({
                    quotaCycleStart: now,
                    createdAt: now,
                }),
            },
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
        expect(state.cycleStart).toBeInstanceOf(Date);
        expect(state.cycleEnd).toBeInstanceOf(Date);
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
    it('upserts the row with increment: 1 keyed on the tenant cycle key', async () => {
        const anchor = new Date('2026-05-12T10:00:00Z');
        const upsert = vi.fn().mockResolvedValue({ messageCount: 7 });
        const prisma = {
            tenant: {
                findUnique: vi.fn().mockResolvedValue({
                    quotaCycleStart: anchor,
                    createdAt: anchor,
                }),
            },
            tenantUsage: { upsert },
        } as any;

        const next = await incrementMessageUsage(prisma, 'tenant-x');
        expect(next).toBe(7);

        const arg = upsert.mock.calls[0][0];
        // The cycle key for an anchor-day query equals the anchor in YYYY-MM-DD.
        expect(arg.where.tenantId_month.tenantId).toBe('tenant-x');
        expect(arg.where.tenantId_month.month).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(arg.create).toMatchObject({ tenantId: 'tenant-x', messageCount: 1 });
        expect(arg.update).toEqual({ messageCount: { increment: 1 } });
    });
});

describe('checkOutboundQuota', () => {
    it('loads the tenant planId and resolves quota', async () => {
        const now = new Date();
        const prisma = {
            tenant: {
                findUnique: vi.fn().mockResolvedValue({
                    planId: 'starter',
                    subscriptionStatus: 'ACTIVE',
                    trialEndsAt: null,
                    currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
                    quotaCycleStart: now,
                    createdAt: now,
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

describe('evaluateSubscription (Phase 4b + 4c)', () => {
    const now = new Date();
    function makePrisma(tenant: any) {
        return {
            tenant: {
                findUnique: vi.fn().mockResolvedValue({
                    quotaCycleStart: now,
                    createdAt: now,
                    ...tenant,
                }),
                update: vi.fn().mockResolvedValue(tenant),
            },
        } as any;
    }

    it('demotes to Free + CANCELLED when TRIALING and trial has expired', async () => {
        const prisma = makePrisma({
            planId: 'pro',
            subscriptionStatus: 'TRIALING',
            trialEndsAt: new Date(Date.now() - DAY_MS), // yesterday
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
            trialEndsAt: new Date(Date.now() + 7 * DAY_MS),
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
            currentPeriodEnd: new Date(Date.now() - 8 * DAY_MS),
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
            currentPeriodEnd: new Date(Date.now() - 2 * DAY_MS),
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
            currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
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

    it('returns the tenant cycle anchor with each resolution', async () => {
        const anchor = new Date('2026-05-12T10:00:00Z');
        const prisma = {
            tenant: {
                findUnique: vi.fn().mockResolvedValue({
                    planId: 'pro',
                    subscriptionStatus: 'ACTIVE',
                    trialEndsAt: null,
                    currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
                    quotaCycleStart: anchor,
                    createdAt: anchor,
                }),
                update: vi.fn(),
            },
        } as any;
        const resolved = await evaluateSubscription(prisma, 't1');
        expect(resolved.cycleAnchor.quotaCycleStart?.toISOString()).toBe(anchor.toISOString());
        expect(resolved.cycleAnchor.createdAt?.toISOString()).toBe(anchor.toISOString());
    });
});
