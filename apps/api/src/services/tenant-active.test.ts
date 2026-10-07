import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ACTIVE_CACHE_MS, clearTenantActiveCache, forgetTenantActive, isTenantActive } from './tenant-active.js';

const reader = (rows: Record<string, { isActive: boolean } | null>) => {
    const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
    return { prisma: { tenant: { findUnique } }, findUnique };
};

beforeEach(() => clearTenantActiveCache());

describe('isTenantActive', () => {
    it('true for an active tenant, false for an inactive or missing one', async () => {
        const { prisma } = reader({ a: { isActive: true }, b: { isActive: false } });
        expect(await isTenantActive(prisma, 'a')).toBe(true);
        expect(await isTenantActive(prisma, 'b')).toBe(false);
        expect(await isTenantActive(prisma, 'gone')).toBe(false);
    });

    it('caches a positive answer briefly, then reads again', async () => {
        const rows: Record<string, { isActive: boolean }> = { a: { isActive: true } };
        const { prisma, findUnique } = reader(rows);
        expect(await isTenantActive(prisma, 'a', 1_000)).toBe(true);
        rows.a = { isActive: false };
        expect(await isTenantActive(prisma, 'a', 1_000 + ACTIVE_CACHE_MS - 1)).toBe(true);
        expect(findUnique).toHaveBeenCalledTimes(1);
        expect(await isTenantActive(prisma, 'a', 1_000 + ACTIVE_CACHE_MS)).toBe(false);
    });

    it('never caches a negative answer: reactivation bites at once', async () => {
        const rows: Record<string, { isActive: boolean }> = { a: { isActive: false } };
        const { prisma } = reader(rows);
        expect(await isTenantActive(prisma, 'a', 1_000)).toBe(false);
        rows.a = { isActive: true };
        expect(await isTenantActive(prisma, 'a', 1_001)).toBe(true);
    });

    it('forgetTenantActive drops the cached answer (deactivation in this process bites at once)', async () => {
        const rows: Record<string, { isActive: boolean }> = { a: { isActive: true } };
        const { prisma } = reader(rows);
        await isTenantActive(prisma, 'a', 1_000);
        rows.a = { isActive: false };
        forgetTenantActive('a');
        expect(await isTenantActive(prisma, 'a', 1_001)).toBe(false);
    });
});
