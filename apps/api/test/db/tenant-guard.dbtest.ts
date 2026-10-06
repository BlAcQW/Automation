import { beforeEach, describe, expect, it } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedBooking, seedConversation, seedService, seedTenant } from './helpers/seed.js';
import { bindTenantContext, runOutsideTenantContext, tenantContext } from '../../src/lib/tenant-context.js';
import { claimOwnerEmail, EmailTakenError } from '../../src/services/email-claim.js';
import { TenantGuardError } from '../../src/plugins/tenant-guard.js';

/** The real extended client from plugins/prisma.ts running against real Postgres. */
describe('tenant guard on the real engine', () => {
    let a: string; let b: string; let bookingA: string; let bookingB: string;
    beforeEach(async () => {
        a = (await seedTenant()).id; b = (await seedTenant()).id;
        const sa = await seedService(a); const sb = await seedService(b);
        bookingA = (await seedBooking(a, sa.id)).id;
        bookingB = (await seedBooking(b, sb.id)).id;
    });
    // The callback MUST await inside the context: a Prisma query is lazy and its
    // `$extends` hook runs when the promise is first awaited. Returning the bare
    // PrismaPromise out of `run()` (a non-async arrow) would execute it with no
    // context at all, and the guard would never see the tenant.
    const asTenant = <T>(tenantId: string, fn: () => PromiseLike<T>) =>
        tenantContext.run({ tenantId, userId: 'u1' }, async () => await fn());

    it('blocks an unscoped query inside a bound tenant context', async () => {
        const prisma = await guardedPrisma();
        await expect(asTenant(a, () => prisma.booking.findMany({}))).rejects.toBeInstanceOf(TenantGuardError);
        await expect(asTenant(a, () => prisma.booking.findMany({ where: { status: 'PENDING_PAYMENT' } }))).rejects.toBeInstanceOf(TenantGuardError);
    });

    it('blocks by-id access that omits tenantId (the verify-then-mutate-by-id hole)', async () => {
        const prisma = await guardedPrisma();
        await expect(asTenant(a, () => prisma.booking.findUnique({ where: { id: bookingB } }))).rejects.toBeInstanceOf(TenantGuardError);
        await expect(asTenant(a, () => prisma.booking.update({ where: { id: bookingB }, data: { notes: 'pwned' } }))).rejects.toBeInstanceOf(TenantGuardError);
        await expect(asTenant(a, () => prisma.booking.updateMany({ where: { id: bookingB }, data: { notes: 'pwned' } }))).rejects.toBeInstanceOf(TenantGuardError);
        await expect(asTenant(a, () => prisma.booking.deleteMany({ where: { id: bookingB } }))).rejects.toBeInstanceOf(TenantGuardError);
        await expect(asTenant(a, () => prisma.booking.count())).rejects.toBeInstanceOf(TenantGuardError);
        // Nothing leaked or changed.
        const row = await rawPrisma().booking.findUniqueOrThrow({ where: { id: bookingB } });
        expect(row.notes).toBeNull();
    });

    it('allows a scoped query and returns only that tenant\'s rows', async () => {
        const prisma = await guardedPrisma();
        const rows = await asTenant(a, () => prisma.booking.findMany({ where: { tenantId: a } }));
        expect(rows.map((r) => r.id)).toEqual([bookingA]);
        const other = await asTenant(a, () => prisma.booking.findFirst({ where: { id: bookingB, tenantId: a } }));
        expect(other).toBeNull();
        const upd = await asTenant(a, () => prisma.booking.updateMany({ where: { id: bookingA, tenantId: a }, data: { notes: 'ok' } }));
        expect(upd.count).toBe(1);
    });

    it('accepts compound unique keys that carry tenantId', async () => {
        const prisma = await guardedPrisma();
        await rawPrisma().tenantUsage.create({ data: { tenantId: a, month: '2026-10-01' } });
        const row = await asTenant(a, () => prisma.tenantUsage.findUnique({ where: { tenantId_month: { tenantId: a, month: '2026-10-01' } } }));
        expect(row?.tenantId).toBe(a);
    });

    it('blocks inside an interactive transaction too', async () => {
        const prisma = await guardedPrisma();
        await expect(asTenant(a, () => prisma.$transaction((tx) => tx.booking.findMany({})))).rejects.toBeInstanceOf(TenantGuardError);
        const ok = await asTenant(a, () => prisma.$transaction((tx) => tx.booking.findMany({ where: { tenantId: a } })));
        expect(ok).toHaveLength(1);
    });

    it('runOutsideTenantContext lets the global email claim run inside a tenant request (staff invite) and catches a taken address', async () => {
        const prisma = await guardedPrisma();
        await rawPrisma().user.create({ data: { tenantId: b, email: 'Taken@Example.com', passwordHash: 'x', name: 'Other', role: 'OWNER' } });
        // Without the escape the guard blocks the cross-tenant lookup...
        await expect(asTenant(a, () => prisma.$transaction((tx) => claimOwnerEmail(tx, 'free@example.com')))).rejects.toBeInstanceOf(TenantGuardError);
        // ...with it, the lookup runs, and still sees the other tenant's user.
        await asTenant(a, () => prisma.$transaction((tx) => runOutsideTenantContext(() => claimOwnerEmail(tx, 'free@example.com'))));
        await expect(asTenant(a, () => prisma.$transaction((tx) => runOutsideTenantContext(() => claimOwnerEmail(tx, 'taken@example.com')))))
            .rejects.toBeInstanceOf(EmailTakenError);
        // And the guard is back on straight after.
        await expect(asTenant(a, () => prisma.$transaction(async (tx) => {
            await runOutsideTenantContext(() => claimOwnerEmail(tx, 'free2@example.com'));
            return tx.booking.findMany({});
        }))).rejects.toBeInstanceOf(TenantGuardError);
    });

    it('context survives awaits and Promise.all (the B2 "context lost after await" regression)', async () => {
        const prisma = await guardedPrisma();
        await tenantContext.run({}, async () => {
            await new Promise((r) => setTimeout(r, 5));
            bindTenantContext({ tenantId: a, userId: 'u1' });
            await new Promise((r) => setTimeout(r, 5));
            await expect(prisma.booking.findMany({})).rejects.toBeInstanceOf(TenantGuardError);
            const results = await Promise.allSettled([
                prisma.booking.findMany({}),
                prisma.booking.findMany({ where: { tenantId: a } }),
            ]);
            expect(results[0].status).toBe('rejected');
            expect(results[1].status).toBe('fulfilled');
        });
    });

    it('two tenants interleaved concurrently never see each other\'s context', async () => {
        const prisma = await guardedPrisma();
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => {
            const me = i % 2 === 0 ? a : b;
            const other = i % 2 === 0 ? b : a;
            return asTenant(me, async () => {
                await new Promise((r) => setTimeout(r, Math.random() * 10));
                const ownRows = await prisma.booking.findMany({ where: { tenantId: me } });
                const blocked = await prisma.booking.findMany({}).then(() => false, (e) => e instanceof TenantGuardError);
                const crossRows = await prisma.booking.findMany({ where: { tenantId: other } }); // scoped (to someone else): the guard cannot judge intent, only presence
                return { ownRows, blocked, crossRows, me };
            });
        }));
        for (const r of results) {
            expect(r.blocked).toBe(true);
            expect(r.ownRows.every((x) => x.tenantId === r.me)).toBe(true);
        }
    });

    it('documents the lazy-promise blind spot: a PrismaPromise returned (not awaited) out of run() escapes the context', async () => {
        const prisma = await guardedPrisma();
        // Not an endorsement: this is what happens if a non-async wrapper hands back the lazy promise.
        const escaped = await tenantContext.run({ tenantId: a }, () => prisma.booking.findMany({}));
        expect(escaped).toHaveLength(2);
    });

    it('allows admin context (even with a tenantId) and no context at all', async () => {
        const prisma = await guardedPrisma();
        const admin = await tenantContext.run({ adminId: 'adm1' }, async () => await prisma.booking.findMany({}));
        expect(admin).toHaveLength(2);
        const adminWithTenant = await tenantContext.run({ tenantId: a, adminId: 'adm1' }, async () => await prisma.booking.findMany({}));
        expect(adminWithTenant).toHaveLength(2);
        expect(await prisma.booking.findMany({})).toHaveLength(2); // worker / webhook
        expect(await tenantContext.run({}, async () => await prisma.booking.findMany({}))).toHaveLength(2); // open but unbound store
    });

    it('does not guard models without a tenantId column, or create operations', async () => {
        const prisma = await guardedPrisma();
        const conv = await seedConversation(a);
        await rawPrisma().message.create({ data: { conversationId: conv.id, direction: 'INBOUND', content: 'hi' } });
        expect(await asTenant(a, () => prisma.message.findMany({}))).toHaveLength(1);
        const created = await asTenant(a, () => prisma.notification.create({ data: { tenantId: a, type: 'SYSTEM', title: 't', message: 'm' } }));
        expect(created.tenantId).toBe(a);
    });

    it('every tenant-scoped model name registered in the guard exists in the real database', async () => {
        const { TENANT_SCOPED_MODELS } = await import('../../src/plugins/prisma.js');
        const rows = await rawPrisma().$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
        const tables = new Set(rows.map((r) => r.tablename));
        for (const m of TENANT_SCOPED_MODELS) expect(tables.has(m), m).toBe(true);
    });
});
