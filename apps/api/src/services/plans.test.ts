import { describe, it, expect, afterEach } from 'vitest';
import {
    effectiveMessageQuota,
    getPaystackPlanCode,
    getPlan,
    isPlanAvailableForVertical,
    isPlatformPaystackConfigured,
    plansForVertical,
    PLAN_CATALOG,
    PLAN_IDS,
    SUBSCRIBABLE_PLAN_IDS,
    subscribeBodySchema,
    type Plan,
} from './plans.js';
import { config } from '../config/index.js';

describe('effectiveMessageQuota', () => {
    const plan = PLAN_CATALOG.starter;

    it('null override uses the plan quota', () => {
        expect(effectiveMessageQuota(plan, null)).toBe(plan.monthlyMessageQuota);
    });
    it('undefined override uses the plan quota', () => {
        expect(effectiveMessageQuota(plan, undefined)).toBe(plan.monthlyMessageQuota);
    });
    it('override replaces the plan quota, even when lower', () => {
        expect(effectiveMessageQuota(plan, 10)).toBe(10);
        expect(effectiveMessageQuota(plan, 1_000_000)).toBe(1_000_000);
    });
    it('0 is a real override (blocks all sends), not "unset"', () => {
        expect(effectiveMessageQuota(plan, 0)).toBe(0);
    });
    it('invalid stored values (negative, NaN, fractional) fall back to the plan', () => {
        expect(effectiveMessageQuota(plan, -1)).toBe(plan.monthlyMessageQuota);
        expect(effectiveMessageQuota(plan, Number.NaN)).toBe(plan.monthlyMessageQuota);
        expect(effectiveMessageQuota(plan, 1.5)).toBe(plan.monthlyMessageQuota);
    });
});

const fakePlan = (id: string, verticals: Plan['verticals'], monthlyPrice = 10): Plan => ({
    ...PLAN_CATALOG.starter, id, verticals, monthlyPrice,
});

describe('plan catalog per vertical', () => {
    it('keeps the existing plan ids, all available to any vertical', () => {
        expect([...PLAN_IDS]).toEqual(['free', 'starter', 'pro']);
        for (const id of PLAN_IDS) {
            expect(isPlanAvailableForVertical(PLAN_CATALOG[id], 'APPOINTMENTS')).toBe(true);
            expect(isPlanAvailableForVertical(PLAN_CATALOG[id], 'RIDES')).toBe(true);
        }
    });
    it('filters a catalog by vertical: any + matching, never the other vertical', () => {
        const catalog = {
            free: fakePlan('free', 'any', 0),
            salon: fakePlan('salon', ['APPOINTMENTS']),
            fleet: fakePlan('fleet', ['RIDES']),
        };
        expect(plansForVertical('APPOINTMENTS', catalog).map((p) => p.id)).toEqual(['free', 'salon']);
        expect(plansForVertical('RIDES', catalog).map((p) => p.id)).toEqual(['free', 'fleet']);
    });
    it('an empty vertical list means available to nobody (fail closed)', () => {
        expect(isPlanAvailableForVertical(fakePlan('x', []), 'RIDES')).toBe(false);
    });
    it('plan ids are safe to turn into an env var name', () => {
        for (const id of PLAN_IDS) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    });
    it('every plan declares its id consistently with its key', () => {
        for (const [key, plan] of Object.entries(PLAN_CATALOG)) expect(plan.id).toBe(key);
    });
    it('getPlan still falls back to free for unknown/null ids', () => {
        expect(getPlan('gold').id).toBe('free');
        expect(getPlan(null).id).toBe('free');
        expect(getPlan('pro').id).toBe('pro');
    });
    it('marks the per-plan feature limits as display-only (not enforced)', () => {
        for (const id of PLAN_IDS) expect(PLAN_CATALOG[id].featuresEnforced).toBe(false);
    });
});

describe('single-source subscribe validation', () => {
    it('subscribable plans are exactly the paid plans in the catalog', () => {
        const paid = PLAN_IDS.filter((id) => PLAN_CATALOG[id].monthlyPrice > 0);
        expect([...SUBSCRIBABLE_PLAN_IDS]).toEqual(paid);
        expect([...SUBSCRIBABLE_PLAN_IDS]).toEqual(['starter', 'pro']);
    });
    it('accepts paid plans and rejects free, unknown, missing and extra input', () => {
        expect(subscribeBodySchema.safeParse({ planId: 'starter' }).success).toBe(true);
        expect(subscribeBodySchema.safeParse({ planId: 'pro' }).success).toBe(true);
        expect(subscribeBodySchema.safeParse({ planId: 'free' }).success).toBe(false);
        expect(subscribeBodySchema.safeParse({ planId: 'gold' }).success).toBe(false);
        expect(subscribeBodySchema.safeParse({}).success).toBe(false);
        expect(subscribeBodySchema.safeParse(undefined).success).toBe(false);
    });
});

describe('paystack plan code lookup', () => {
    const codes = config.platformPaystack.planCodes as Record<string, string | undefined>;
    const keep = { starter: codes.starter, pro: codes.pro, secret: config.platformPaystack.secretKey };
    afterEach(() => {
        Object.assign(codes, { starter: keep.starter, pro: keep.pro });
        (config.platformPaystack as any).secretKey = keep.secret;
        delete process.env.PAYSTACK_PLAN_PRO_CODE_TEST;
        delete process.env.PAYSTACK_PLAN_STARTER_CODE;
    });
    it('reads the configured code for a paid plan; none for free', () => {
        codes.starter = 'PLN_s'; codes.pro = 'PLN_p';
        expect(getPaystackPlanCode('starter')).toBe('PLN_s');
        expect(getPaystackPlanCode('pro')).toBe('PLN_p');
        expect(getPaystackPlanCode('free')).toBeUndefined();
    });
    it('falls back to the PAYSTACK_PLAN_<ID>_CODE convention, so a new plan needs no code change', () => {
        codes.starter = undefined;
        process.env.PAYSTACK_PLAN_STARTER_CODE = 'PLN_env';
        expect(getPaystackPlanCode('starter')).toBe('PLN_env');
    });
    it('treats an empty code as unconfigured', () => {
        codes.pro = '';
        expect(getPaystackPlanCode('pro')).toBeUndefined();
    });
    it('is configured when the secret and at least one paid plan code exist', () => {
        (config.platformPaystack as any).secretKey = 'sk';
        codes.starter = 'PLN_s'; codes.pro = undefined;
        expect(isPlatformPaystackConfigured()).toBe(true);
        codes.starter = undefined;
        expect(isPlatformPaystackConfigured()).toBe(false);
        codes.pro = 'PLN_p'; (config.platformPaystack as any).secretKey = undefined;
        expect(isPlatformPaystackConfigured()).toBe(false);
    });
});
