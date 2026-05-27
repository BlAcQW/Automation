/**
 * Bookly SaaS plan catalog.
 *
 * Defined in code (not DB) so the catalog can evolve without a migration.
 * `Tenant.planId` is a free-form string at the schema layer; we validate
 * against `PLAN_IDS` at every API boundary.
 *
 * Phase 4a enforces only the monthly outbound WhatsApp message quota.
 * `maxServices` / `maxStaff` / `maxTemplates` / `customBranding` ride along
 * for the Settings UI; their enforcement is deferred to Phase 4b.
 */

import { config } from '../config/index.js';

export const PLAN_IDS = ['free', 'starter', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
    id: PlanId;
    name: string;
    monthlyPrice: number;        // major unit, display only
    currency: string;            // 'USD' display
    monthlyMessageQuota: number; // outbound WhatsApp messages per month
    features: {
        maxServices: number | 'unlimited';
        maxStaff: number | 'unlimited';
        maxTemplates: number | 'unlimited';
        customBranding: boolean;
    };
}

export const PLAN_CATALOG: Record<PlanId, Plan> = {
    free: {
        id: 'free',
        name: 'Free',
        monthlyPrice: 0,
        currency: 'USD',
        monthlyMessageQuota: 50,
        features: { maxServices: 3, maxStaff: 1, maxTemplates: 3, customBranding: false },
    },
    starter: {
        id: 'starter',
        name: 'Starter',
        monthlyPrice: 19,
        currency: 'USD',
        monthlyMessageQuota: 500,
        features: { maxServices: 'unlimited', maxStaff: 3, maxTemplates: 'unlimited', customBranding: false },
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        monthlyPrice: 49,
        currency: 'USD',
        monthlyMessageQuota: 5000,
        features: { maxServices: 'unlimited', maxStaff: 'unlimited', maxTemplates: 'unlimited', customBranding: true },
    },
};

/**
 * Resolve a plan by id with a Free fallback for null/undefined/unknown.
 * Never throws — callers can trust a Plan is always returned.
 */
export function getPlan(planId: string | null | undefined): Plan {
    if (planId && (PLAN_IDS as readonly string[]).includes(planId)) {
        return PLAN_CATALOG[planId as PlanId];
    }
    return PLAN_CATALOG.free;
}

/**
 * Resolve the Paystack plan code for a paid plan. Read from env at call
 * time so test/dev installs without Paystack still function. Free returns
 * undefined (no Paystack plan associated).
 */
export function getPaystackPlanCode(planId: PlanId): string | undefined {
    if (planId === 'starter') return config.platformPaystack.planCodes.starter || undefined;
    if (planId === 'pro') return config.platformPaystack.planCodes.pro || undefined;
    return undefined;
}

/**
 * True iff the platform's own Paystack credentials are configured. Used to
 * gate `/billing/subscribe` with a clean 503 when Paystack isn't set up yet.
 */
export function isPlatformPaystackConfigured(): boolean {
    return !!(
        config.platformPaystack.secretKey &&
        config.platformPaystack.planCodes.starter &&
        config.platformPaystack.planCodes.pro
    );
}
