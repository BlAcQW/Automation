import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { TENANT_SCOPED_MODELS, hasTenantFilter } from './prisma.js';

// Models that have a `tenantId` column but are deliberately NOT guarded.
// Every entry needs a reason. Empty today: adding one here is a conscious
// decision, not a way to silence this test.
const TENANT_ID_EXEMPT_MODELS: Record<string, string> = {};

// Models in the allowlist that have no tenantId column at all (would warn
// unconditionally). Must stay empty; scope these through their parent.
const NO_TENANT_ID_MODELS = ['Message', 'OrderItem', 'CalendarEvent'];

describe('TENANT_SCOPED_MODELS', () => {
    const models = Prisma.dmmf.datamodel.models;
    const withTenantId = models
        .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
        .map((m) => m.name);

    it('registers every model that has a tenantId field (except documented exemptions)', () => {
        const expected = withTenantId
            .filter((name) => !(name in TENANT_ID_EXEMPT_MODELS))
            .sort();
        expect([...TENANT_SCOPED_MODELS].sort()).toEqual(expected);
    });

    it('only registers models that exist in the schema and carry tenantId', () => {
        const modelNames = new Set(models.map((m) => m.name));
        for (const name of TENANT_SCOPED_MODELS) {
            expect(modelNames.has(name), `${name} is not a schema model`).toBe(true);
            expect(withTenantId, `${name} has no tenantId column`).toContain(name);
        }
    });

    it('does not register models without a tenantId column', () => {
        for (const name of NO_TENANT_ID_MODELS) {
            expect(TENANT_SCOPED_MODELS.has(name)).toBe(false);
        }
    });

    it('exemptions are real tenant-bearing models', () => {
        for (const name of Object.keys(TENANT_ID_EXEMPT_MODELS)) {
            expect(withTenantId).toContain(name);
        }
    });

    it('registers the previously missing tenant-bearing models', () => {
        for (const name of [
            'User', 'DeviceToken', 'PromoRedemption', 'AuditLog', 'TenantUsage',
            'Wallet', 'LedgerMovement', 'LedgerEntry', 'PayoutRecipient', 'PayoutRequest',
        ]) {
            expect(TENANT_SCOPED_MODELS.has(name), name).toBe(true);
        }
    });
});

describe('hasTenantFilter', () => {
    it('accepts a top-level string tenantId', () => {
        expect(hasTenantFilter({ tenantId: 't1', id: 'x' })).toBe(true);
    });

    it('accepts an object tenantId filter', () => {
        expect(hasTenantFilter({ tenantId: { in: ['t1', 't2'] } })).toBe(true);
    });

    it('accepts a tenantId_* compound unique key', () => {
        expect(hasTenantFilter({ tenantId_email: { tenantId: 't1', email: 'a@b.c' } })).toBe(true);
    });

    it('rejects a where without tenantId', () => {
        expect(hasTenantFilter({ id: 'x' })).toBe(false);
    });

    it('rejects undefined, null, non-objects and empty objects', () => {
        expect(hasTenantFilter(undefined)).toBe(false);
        expect(hasTenantFilter(null)).toBe(false);
        expect(hasTenantFilter('tenantId')).toBe(false);
        expect(hasTenantFilter({})).toBe(false);
    });

    it('rejects null/undefined tenantId values', () => {
        expect(hasTenantFilter({ tenantId: undefined })).toBe(false);
        expect(hasTenantFilter({ tenantId: null })).toBe(false);
    });

    it('does not match keys that merely contain tenantId', () => {
        expect(hasTenantFilter({ otherTenantId: 't1' })).toBe(false);
    });
});
