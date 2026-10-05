/**
 * Per-vertical Tenant defaults. Pure: returns the Tenant field values a
 * vertical needs, to be merged into a create/update.
 */
import type { Vertical, Tenant } from '@prisma/client';

export const VERTICALS = ['APPOINTMENTS', 'RIDES'] as const satisfies readonly Vertical[];

export type VerticalDefaults = Partial<Pick<Tenant, 'depositRequired'>>;

export function verticalDefaults(vertical: Vertical): VerticalDefaults {
    switch (vertical) {
        case 'RIDES':
            // A ride business with deposits on would have its bookings
            // auto-cancelled by hold-expiry, and salon deposits do not apply.
            return { depositRequired: false };
        case 'APPOINTMENTS':
            return {};
    }
}
