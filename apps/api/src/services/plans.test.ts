import { describe, it, expect } from 'vitest';
import { effectiveMessageQuota, PLAN_CATALOG } from './plans.js';

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
