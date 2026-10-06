import { describe, it, expect, vi } from 'vitest';
import { currentCycleKey } from '../../services/usage.js';
import { messagesThisCycleByTenant } from './tenant-usage.js';

const t = (id: string, start: string) => ({
    id,
    quotaCycleStart: new Date(start),
    createdAt: new Date(start),
});

describe('messagesThisCycleByTenant', () => {
    it('returns an empty map without querying when there are no tenants', async () => {
        const findMany = vi.fn();
        const m = await messagesThisCycleByTenant({ tenantUsage: { findMany } } as any, []);
        expect(m.size).toBe(0);
        expect(findMany).not.toHaveBeenCalled();
    });

    it('reads the exact row for each tenant cycle key, ignoring other cycles', async () => {
        const now = new Date('2026-03-10T00:00:00Z');
        const a = t('a', '2026-03-01T00:00:00Z');
        const b = t('b', '2026-01-01T00:00:00Z');
        const keyA = currentCycleKey(a, now);
        const keyB = currentCycleKey(b, now);
        const findMany = vi.fn(async (_args: any) => [
            { tenantId: 'a', month: keyA, messageCount: 7 },
            { tenantId: 'b', month: keyB, messageCount: 3 },
            // a row from an older cycle that would have shadowed the right one before
            { tenantId: 'a', month: '2099-01-01', messageCount: 999 },
        ]);
        const m = await messagesThisCycleByTenant({ tenantUsage: { findMany } } as any, [a, b], now);
        expect(findMany.mock.calls[0][0].where).toEqual({
            OR: [{ tenantId: 'a', month: keyA }, { tenantId: 'b', month: keyB }],
        });
        expect(m.get('a')).toBe(7);
        expect(m.get('b')).toBe(3);
    });

    it('is 0 for a tenant with no row this cycle', async () => {
        const a = t('a', '2026-03-01T00:00:00Z');
        const m = await messagesThisCycleByTenant({ tenantUsage: { findMany: vi.fn(async () => []) } } as any, [a], new Date('2026-03-02T00:00:00Z'));
        expect(m.get('a')).toBe(0);
    });
});
