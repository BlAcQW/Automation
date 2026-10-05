import { describe, it, expect } from 'vitest';
import { parseTenantUpdate, buildTenantUpdateData } from './tenant-update.js';

describe('parseTenantUpdate', () => {
    it('accepts the allowlisted fields', () => {
        const r = parseTenantUpdate({
            name: 'Acme', isActive: false, timezone: 'Africa/Accra', planId: 'pro',
            vertical: 'RIDES', monthlyMessageQuotaOverride: 100,
        });
        expect(r.success).toBe(true);
    });
    it('rejects unknown fields (mass assignment)', () => {
        for (const k of ['paystackSecretKey', 'whatsappAccessToken', 'depositRequired', 'id', 'subscriptionStatus']) {
            expect(parseTenantUpdate({ name: 'Acme', [k]: 'x' }).success).toBe(false);
        }
    });
    it('rejects negative, fractional and non-numeric overrides', () => {
        for (const v of [-1, 1.5, '5', Number.NaN]) {
            expect(parseTenantUpdate({ monthlyMessageQuotaOverride: v }).success).toBe(false);
        }
    });
    it('accepts 0 and null override', () => {
        expect(parseTenantUpdate({ monthlyMessageQuotaOverride: 0 }).success).toBe(true);
        expect(parseTenantUpdate({ monthlyMessageQuotaOverride: null }).success).toBe(true);
    });
    it('rejects an unknown vertical, unknown plan, short name', () => {
        expect(parseTenantUpdate({ vertical: 'TAXI' }).success).toBe(false);
        expect(parseTenantUpdate({ planId: 'gold' }).success).toBe(false);
        expect(parseTenantUpdate({ name: 'A' }).success).toBe(false);
    });
    it('rejects non-object bodies', () => {
        expect(parseTenantUpdate(null).success).toBe(false);
        expect(parseTenantUpdate('x').success).toBe(false);
    });
});

describe('buildTenantUpdateData', () => {
    it('merges vertical defaults when the vertical actually changes', () => {
        expect(buildTenantUpdateData({ vertical: 'RIDES' }, 'APPOINTMENTS'))
            .toEqual({ vertical: 'RIDES', depositRequired: false });
    });
    it('does not re-apply defaults when the vertical is unchanged', () => {
        expect(buildTenantUpdateData({ vertical: 'RIDES' }, 'RIDES')).toEqual({ vertical: 'RIDES' });
    });
    it('does not touch defaults when vertical is absent', () => {
        expect(buildTenantUpdateData({ name: 'Acme' }, 'RIDES')).toEqual({ name: 'Acme' });
    });
    it('switching to APPOINTMENTS adds nothing', () => {
        expect(buildTenantUpdateData({ vertical: 'APPOINTMENTS' }, 'RIDES')).toEqual({ vertical: 'APPOINTMENTS' });
    });
    it('does not mutate its input', () => {
        const input = Object.freeze({ vertical: 'RIDES' as const });
        expect(() => buildTenantUpdateData(input, 'APPOINTMENTS')).not.toThrow();
    });
});

describe('monthlyMessageQuotaOverride upper bound', () => {
    it('accepts the cap and rejects anything above it', async () => {
        const { parseTenantUpdate, MAX_QUOTA_OVERRIDE } = await import('./tenant-update.js');
        expect(parseTenantUpdate({ monthlyMessageQuotaOverride: MAX_QUOTA_OVERRIDE }).success).toBe(true);
        expect(parseTenantUpdate({ monthlyMessageQuotaOverride: MAX_QUOTA_OVERRIDE + 1 }).success).toBe(false);
        // Beyond Postgres INT: must be a 400, never reach Prisma as a 500.
        expect(parseTenantUpdate({ monthlyMessageQuotaOverride: 3_000_000_000 }).success).toBe(false);
    });
});
