/**
 * Bookly SaaS plan catalog.
 *
 * Defined in code (not DB) so the catalog can evolve without a migration.
 * `Tenant.planId` is a free-form string at the schema layer; we validate
 * against `PLAN_IDS` at every API boundary.
 *
 * Only the monthly outbound WhatsApp message quota is enforced. The
 * `features` limits are display-only (see Plan.features).
 */

import { z } from 'zod';
import { config } from '../config/index.js';

/** The verticals a plan can be restricted to (mirrors the Prisma `Vertical` enum). */
export type PlanVertical = 'APPOINTMENTS' | 'RIDES';

export interface Plan {
    id: string;
    name: string;
    monthlyPrice: number;        // major unit, display only
    currency: string;            // 'USD' display
    monthlyMessageQuota: number; // outbound WhatsApp messages per month
    /**
     * Which verticals may be on this plan. 'any' = all of them. An empty list
     * means nobody (fails closed), never "everybody".
     */
    verticals: readonly PlanVertical[] | 'any';
    /**
     * DISPLAY ONLY. These limits are shown in Settings but NOT enforced
     * anywhere server-side (the create endpoints for services / staff /
     * templates and the branding setting do not consult the plan). Only the
     * monthly message quota is enforced. `featuresEnforced` says so in the
     * API contract so no client mistakes the numbers for a guarantee.
     */
    features: {
        maxServices: number | 'unlimited';
        maxStaff: number | 'unlimited';
        maxTemplates: number | 'unlimited';
        customBranding: boolean;
    };
    featuresEnforced: false;
}

/**
 * Add a plan HERE and nowhere else: the id list, the subscribe validation,
 * the vertical filter and the Paystack lookup all derive from this object.
 * A paid plan (monthlyPrice > 0) is self-serve subscribable once its Paystack
 * plan code is set in the env as PAYSTACK_PLAN_<ID>_CODE (e.g.
 * PAYSTACK_PLAN_GROWTH_CODE).
 */
function definePlans<K extends string>(defs: Record<K, Omit<Plan, 'id' | 'featuresEnforced'>>): Record<K, Plan> {
    const out = {} as Record<K, Plan>;
    for (const id of Object.keys(defs) as K[]) out[id] = { ...defs[id], id, featuresEnforced: false };
    return out;
}

export const PLAN_CATALOG = definePlans({
    free: {
        name: 'Free',
        monthlyPrice: 0,
        currency: 'USD',
        monthlyMessageQuota: 50,
        verticals: 'any',
        features: { maxServices: 3, maxStaff: 1, maxTemplates: 3, customBranding: false },
    },
    starter: {
        name: 'Starter',
        monthlyPrice: 19,
        currency: 'USD',
        monthlyMessageQuota: 500,
        verticals: 'any',
        features: { maxServices: 'unlimited', maxStaff: 3, maxTemplates: 'unlimited', customBranding: false },
    },
    pro: {
        name: 'Pro',
        monthlyPrice: 49,
        currency: 'USD',
        monthlyMessageQuota: 5000,
        verticals: 'any',
        features: { maxServices: 'unlimited', maxStaff: 'unlimited', maxTemplates: 'unlimited', customBranding: true },
    },
});

export type PlanId = keyof typeof PLAN_CATALOG;
export const PLAN_IDS = Object.keys(PLAN_CATALOG) as [PlanId, ...PlanId[]];

/** Paid plans: the ones a tenant can subscribe to through Paystack. */
export const SUBSCRIBABLE_PLAN_IDS = PLAN_IDS.filter((id) => PLAN_CATALOG[id].monthlyPrice > 0) as [PlanId, ...PlanId[]];

/** POST /billing/subscribe body. Derived from the catalog, never hand-listed. */
export const subscribeBodySchema = z.object({
    planId: z.enum(SUBSCRIBABLE_PLAN_IDS),
});

export function isPlanAvailableForVertical(plan: Pick<Plan, 'verticals'>, vertical: PlanVertical): boolean {
    return plan.verticals === 'any' || plan.verticals.includes(vertical);
}

/** The plans a tenant of `vertical` may be on (any-vertical plans + that vertical's). */
export function plansForVertical(
    vertical: PlanVertical,
    catalog: Record<string, Plan> = PLAN_CATALOG,
): Plan[] {
    return Object.values(catalog).filter((p) => isPlanAvailableForVertical(p, vertical));
}

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
 * Resolve the Paystack plan code for a paid plan. Read at call time so
 * test/dev installs without Paystack still function: config first (the two
 * historic env names), then the PAYSTACK_PLAN_<ID>_CODE convention so a new
 * plan needs no config edit. Free (and anything unset/empty) is undefined.
 */
export function getPaystackPlanCode(planId: PlanId): string | undefined {
    if (PLAN_CATALOG[planId].monthlyPrice <= 0) return undefined;
    const fromConfig = (config.platformPaystack.planCodes as Record<string, string | undefined>)[planId];
    return fromConfig || process.env[`PAYSTACK_PLAN_${planId.toUpperCase()}_CODE`] || undefined;
}

/**
 * True iff the platform's own Paystack credentials are configured and at least
 * one paid plan has a code. Used to gate `/billing/subscribe` with a clean 503;
 * the route still checks the chosen plan's own code.
 */
export function isPlatformPaystackConfigured(): boolean {
    return !!config.platformPaystack.secretKey && SUBSCRIBABLE_PLAN_IDS.some((id) => !!getPaystackPlanCode(id));
}

/**
 * The monthly message quota that actually applies to a tenant. A per-tenant
 * override (admin-set) replaces the plan's quota; null/undefined means "plan
 * default". 0 is a real override. Values that could never have passed the
 * API boundary (negative, fractional, NaN) fall back to the plan rather than
 * throwing, so a bad row cannot break the send path.
 */
export function effectiveMessageQuota(
    plan: Pick<Plan, 'monthlyMessageQuota'>,
    override: number | null | undefined,
): number {
    if (override === null || override === undefined) return plan.monthlyMessageQuota;
    if (!Number.isInteger(override) || override < 0) return plan.monthlyMessageQuota;
    return override;
}
