/**
 * Is this organisation still active? Asked by `fastify.authenticate` on every
 * user request, so a deactivated (or deleted) organisation's staff are cut off
 * within seconds instead of keeping a 15-minute access token alive.
 *
 * Only POSITIVE answers are cached, for ACTIVE_CACHE_MS, per process. A
 * deactivation in this process clears the entry at once (`forgetTenantActive`);
 * other processes stop serving the tenant within ACTIVE_CACHE_MS. An inactive
 * or missing tenant is never cached, so reactivation also bites immediately.
 */

interface TenantActiveReader {
    tenant: {
        findUnique(args: { where: { id: string }; select: { isActive: true } }): Promise<{ isActive: boolean } | null>;
    };
}

export const ACTIVE_CACHE_MS = 30_000;
const MAX_ENTRIES = 10_000;

const activeAt = new Map<string, number>();

export async function isTenantActive(prisma: TenantActiveReader, tenantId: string, now: number = Date.now()): Promise<boolean> {
    const at = activeAt.get(tenantId);
    if (at !== undefined && now - at < ACTIVE_CACHE_MS) return true;
    const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { isActive: true } });
    if (!row || row.isActive === false) {
        activeAt.delete(tenantId);
        return false;
    }
    if (activeAt.size >= MAX_ENTRIES) activeAt.clear();
    activeAt.set(tenantId, now);
    return true;
}

/** Drop this process's cached answer (after deactivating or deleting). */
export function forgetTenantActive(tenantId: string): void {
    activeAt.delete(tenantId);
}

/** Tests only. */
export function clearTenantActiveCache(): void {
    activeAt.clear();
}
