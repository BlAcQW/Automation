import { describe, it, expect } from 'vitest';
import { alertListQuerySchema, buildAlertWhere } from './alerts.js';

describe('alert list query', () => {
    it('defaults to open, page 1, limit 20', () => {
        expect(alertListQuerySchema.parse({})).toMatchObject({ status: 'open', page: 1, limit: 20 });
    });
    it('rejects unknown status/severity and oversize limit', () => {
        expect(alertListQuerySchema.safeParse({ status: 'x' }).success).toBe(false);
        expect(alertListQuerySchema.safeParse({ severity: 'meh' }).success).toBe(false);
        expect(alertListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    });
    it('builds the where clause', () => {
        expect(buildAlertWhere(alertListQuerySchema.parse({}))).toEqual({ resolvedAt: null });
        expect(buildAlertWhere(alertListQuerySchema.parse({ status: 'resolved', severity: 'critical', tenantId: 't1' })))
            .toEqual({ resolvedAt: { not: null }, severity: 'critical', tenantId: 't1' });
    });
});
