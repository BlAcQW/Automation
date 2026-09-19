import { describe, expect, it } from 'vitest';
import { applyPromo, generatePromoCode, normalizePromoCode } from './promo.js';

const DAY = 86_400_000;
const now = new Date('2026-09-19T12:00:00Z');

describe('promo codes', () => {
    it('generates readable codes without ambiguous characters', () => {
        for (let i = 0; i < 50; i += 1) {
            const c = generatePromoCode('LAUNCH');
            expect(c).toMatch(/^LAUNCH-[A-HJ-NP-Z2-9]{8}$/);
        }
        expect(generatePromoCode()).toHaveLength(8);
    });

    it('normalises what people type', () => {
        expect(normalizePromoCode(' launch-abc 123 ')).toBe('LAUNCH-ABC123');
        expect(normalizePromoCode('ok!!')).toBe('OK');
    });

    it('extends a live trial from its current end date', () => {
        const trialEndsAt = new Date(now.getTime() + 5 * DAY);
        const r = applyPromo({ planId: 'pro', subscriptionStatus: 'TRIALING', trialEndsAt }, { kind: 'TRIAL_EXTENSION', days: 30, planId: null }, now);
        expect(r.planId).toBe('pro');
        expect(r.trialEndsAt.getTime()).toBe(trialEndsAt.getTime() + 30 * DAY);
    });

    it('gives a lapsed free account Pro from today', () => {
        const r = applyPromo({ planId: 'free', subscriptionStatus: 'CANCELLED', trialEndsAt: new Date(now.getTime() - DAY) }, { kind: 'TRIAL_EXTENSION', days: 14, planId: null }, now);
        expect(r.planId).toBe('pro');
        expect(r.trialEndsAt.getTime()).toBe(now.getTime() + 14 * DAY);
    });

    it('a plan grant sets the named plan, and ignores unknown plans', () => {
        const r = applyPromo({ planId: 'free', subscriptionStatus: null, trialEndsAt: null }, { kind: 'PLAN_GRANT', days: 60, planId: 'starter' }, now);
        expect(r.planId).toBe('starter');
        const bad = applyPromo({ planId: 'free', subscriptionStatus: null, trialEndsAt: null }, { kind: 'PLAN_GRANT', days: 60, planId: 'enterprise' }, now);
        expect(bad.planId).toBe('pro');
    });
});
