import { currentCycleKey, type TenantCycleAnchor } from '../../services/usage.js';

interface UsageReader {
    tenantUsage: {
        findMany: (args: any) => Promise<Array<{ tenantId: string; month: string; messageCount: number }>>;
    };
}

/**
 * Messages sent in each tenant's CURRENT cycle. Reads the exact
 * (tenantId, cycleKey) row, not "latest row by month", so a stray or
 * later-keyed row cannot hide the real count.
 */
export async function messagesThisCycleByTenant(
    prisma: UsageReader,
    tenants: Array<TenantCycleAnchor & { id: string }>,
    now: Date = new Date(),
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (tenants.length === 0) return out;
    const keys = new Map<string, string>();
    for (const t of tenants) {
        keys.set(t.id, currentCycleKey(t, now));
        out.set(t.id, 0);
    }
    const rows = await prisma.tenantUsage.findMany({
        where: { OR: tenants.map((t) => ({ tenantId: t.id, month: keys.get(t.id)! })) },
        select: { tenantId: true, month: true, messageCount: true },
    });
    for (const r of rows) {
        if (keys.get(r.tenantId) === r.month) out.set(r.tenantId, r.messageCount);
    }
    return out;
}
