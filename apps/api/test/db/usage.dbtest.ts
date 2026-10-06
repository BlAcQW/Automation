import { beforeEach, describe, expect, it } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedTenant } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import {
    currentCycleKey, getQuotaState, incrementPlatformSmsUsage, rollbackOutboundReservation, tryReserveOutbound,
} from '../../src/services/usage.js';

async function warmPool(prisma: Awaited<ReturnType<typeof guardedPrisma>>) {
    await Promise.all(Array.from({ length: 30 }, () => prisma.tenant.count()));
}

describe('usage quota on a real database', () => {
    let tenantId: string;
    beforeEach(async () => {
        tenantId = (await seedTenant({ monthlyMessageQuotaOverride: 5 })).id;
    });

    async function seedUsageRow() {
        const t = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
        await rawPrisma().tenantUsage.create({ data: { tenantId, month: currentCycleKey(t), messageCount: 0 } });
    }

    async function used() {
        const t = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
        const row = await rawPrisma().tenantUsage.findUnique({ where: { tenantId_month: { tenantId, month: currentCycleKey(t) } } });
        return row?.messageCount ?? 0;
    }

    it('tryReserveOutbound under concurrency respects the cap exactly', async () => {
        const prisma = await guardedPrisma();
        await seedUsageRow();
        const { ok, failed } = await race(40, () => tryReserveOutbound(prisma, tenantId));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(ok.filter((r) => r.ok)).toHaveLength(5);
        expect(ok.filter((r) => !r.ok)).toHaveLength(35);
        expect(await used()).toBe(5);
        expect(await rawPrisma().tenantUsage.count({ where: { tenantId } })).toBe(1);
    });

    it('rollbacks free slots and never go negative', async () => {
        const prisma = await guardedPrisma();
        await seedUsageRow();
        await race(5, () => tryReserveOutbound(prisma, tenantId));
        await race(3, () => rollbackOutboundReservation(prisma, tenantId));
        expect(await used()).toBe(2);
        await race(10, () => rollbackOutboundReservation(prisma, tenantId));
        expect(await used()).toBe(0);
        const { ok } = await race(8, () => tryReserveOutbound(prisma, tenantId));
        expect(ok.filter((r) => r.ok)).toHaveLength(5);
    });

    it('reserve and rollback racing together keep the count within [0, cap]', async () => {
        const prisma = await guardedPrisma();
        await seedUsageRow();
        await race(20, (i) => (i % 2 === 0 ? tryReserveOutbound(prisma, tenantId) : rollbackOutboundReservation(prisma, tenantId)));
        const n = await used();
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(5);
    });

    it('first reservation of a cycle (no usage row yet): the cap is never exceeded and the count equals the successes', async () => {
        const prisma = await guardedPrisma();
        await warmPool(prisma);
        const { ok } = await race(20, () => tryReserveOutbound(prisma, tenantId));
        const granted = ok.filter((r) => r.ok).length;
        expect(granted).toBeGreaterThanOrEqual(1);
        expect(granted).toBeLessThanOrEqual(5);
        expect(await used()).toBe(granted);
        expect(await rawPrisma().tenantUsage.count({ where: { tenantId } })).toBe(1);
    });

    // BUG (reported, not fixed here): usage.ts tryReserveOutbound (and
    // incrementPlatformSmsUsage) call `tenantUsage.upsert`; when several callers
    // hit a tenant with no row for the cycle yet, the losers throw P2002
    // (Unique constraint on tenantId,month) instead of reserving. The cap holds,
    // but the first concurrent messages of every cycle error out of deliverReply.
    it('BUG: concurrent first reservations of a cycle never throw', async () => {
        const prisma = await guardedPrisma();
        await warmPool(prisma);
        for (let round = 0; round < 6; round++) {
            const t = await seedTenant({ monthlyMessageQuotaOverride: 50 });
            const { failed } = await race(12, () => tryReserveOutbound(prisma, t.id));
            expect(failed.map((e) => `${e?.code}`), `round ${round}`).toEqual([]);
        }
    });

    it('getQuotaState reads what was reserved; platform SMS count shares the row', async () => {
        const prisma = await guardedPrisma();
        await seedUsageRow();
        await race(3, () => tryReserveOutbound(prisma, tenantId));
        await race(4, () => incrementPlatformSmsUsage(prisma, tenantId));
        const q = await getQuotaState(prisma, tenantId, 'free');
        expect(q).toMatchObject({ used: 3, limit: 5, ok: true });
        const rows = await rawPrisma().tenantUsage.findMany({ where: { tenantId } });
        expect(rows).toHaveLength(1);
        expect(rows[0].platformSmsCount).toBe(4);
    });

    it('an expired trial is demoted to free exactly once and the cap follows the plan', async () => {
        const t = await seedTenant({ planId: 'pro', subscriptionStatus: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000) });
        const prisma = await guardedPrisma();
        await race(5, () => tryReserveOutbound(prisma, t.id));
        const after = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: t.id } });
        expect(after.planId).toBe('free');
        expect(after.subscriptionStatus).toBe('CANCELLED');
    });
});
