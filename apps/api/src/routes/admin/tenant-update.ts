import { z } from 'zod';
import type { Vertical } from '@prisma/client';
import { PLAN_IDS } from '../../services/plans.js';
import { VERTICALS, verticalDefaults } from '../../services/verticals.js';

export const MAX_QUOTA_OVERRIDE = 1_000_000;

/**
 * Allowlist for PATCH /admin/tenants/:id. `.strict()` makes unknown keys a
 * validation error (400) instead of being passed to Prisma.
 *
 * name/isActive/timezone/planId were the fields the route already accepted;
 * vertical and monthlyMessageQuotaOverride are new.
 */
export const updateTenantSchema = z.object({
    name: z.string().min(2).optional(),
    isActive: z.boolean().optional(),
    timezone: z.string().optional(),
    planId: z.enum(PLAN_IDS).optional(),
    vertical: z.enum(VERTICALS).optional(),
    // Upper bound keeps the value inside Postgres INT (a larger value would
    // surface as a 500) and well clear of "effectively unlimited" by typo.
    monthlyMessageQuotaOverride: z.number().int().min(0).max(MAX_QUOTA_OVERRIDE).nullable().optional(),
}).strict();

export type TenantUpdateInput = z.infer<typeof updateTenantSchema>;

export function parseTenantUpdate(body: unknown) {
    return updateTenantSchema.safeParse(body);
}

/**
 * Prisma `data` for the update. When the vertical actually changes, the new
 * vertical's defaults are merged in (explicit fields in the body still win,
 * though the schema currently allows none that collide).
 */
export function buildTenantUpdateData(
    input: TenantUpdateInput,
    currentVertical: Vertical,
): TenantUpdateInput & ReturnType<typeof verticalDefaults> {
    if (input.vertical !== undefined && input.vertical !== currentVertical) {
        return { ...verticalDefaults(input.vertical), ...input };
    }
    return { ...input };
}
