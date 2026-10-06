import { beforeEach, describe, expect, it } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { seedBooking, seedConversation, seedFundedWallet, seedPayoutRecipient, seedService, seedTenant, seedUser } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { OrderError, createOrderAtomic } from '../../src/services/order-create.js';
import { cancelOrderAndRestock, expireUnpaidOrders } from '../../src/services/order-expiry.js';
import { buildAttention } from '../../src/routes/admin/attention.js';
import { raiseAlert } from '../../src/services/alerts.js';

describe('createOrderAtomic stock handling', () => {
    let tenantId: string;
    beforeEach(async () => { tenantId = (await seedTenant()).id; });
    const product = (stock: number, price = 10) => rawPrisma().product.create({ data: { tenantId, name: `P${Math.random()}`, price, stock } });
    const order = async (items: Array<{ productId: string; quantity: number }>) =>
        createOrderAtomic({ prisma: await guardedPrisma(), tenantId, customerName: 'Kojo', customerPhone: '+233241234567', currency: 'GHS', items });

    it('never oversells: 12 racing single-unit orders against stock 5 -> exactly 5 orders, stock 0', async () => {
        const p = await product(5);
        const { ok, failed } = await race(12, () => order([{ productId: p.id, quantity: 1 }]));
        expect(ok).toHaveLength(5);
        expect(failed).toHaveLength(7);
        for (const e of failed) expect(e).toMatchObject({ code: 'OUT_OF_STOCK' });
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
        expect(await rawPrisma().order.count({ where: { tenantId } })).toBe(5);
        expect(await rawPrisma().orderItem.count()).toBe(5);
    });

    it('a multi-line order that cannot be fully served rolls everything back (no order, no partial decrement)', async () => {
        const plenty = await product(10);
        const scarce = await product(1);
        await expect(order([{ productId: plenty.id, quantity: 3 }, { productId: scarce.id, quantity: 2 }]))
            .rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: plenty.id } })).stock).toBe(10);
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: scarce.id } })).stock).toBe(1);
        expect(await rawPrisma().order.count()).toBe(0);
    });

    it('opposite-ordered multi-line orders racing do not deadlock and conserve stock', async () => {
        const a = await product(20); const b = await product(20);
        const { ok, failed } = await race(10, (i) => order(i % 2 === 0
            ? [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }]
            : [{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }]));
        expect(failed.map((e) => String(e?.message ?? e).slice(0, 100))).toEqual([]);
        expect(ok).toHaveLength(10);
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: a.id } })).stock).toBe(10);
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: b.id } })).stock).toBe(10);
    });

    it('stores exact totals (3 x 0.10 = 0.30), links a customer record, and is tenant-scoped', async () => {
        const p = await product(10, 0.1);
        const other = (await seedTenant()).id;
        const foreign = await rawPrisma().product.create({ data: { tenantId: other, name: 'theirs', price: 1, stock: 5 } });
        const o: any = await order([{ productId: p.id, quantity: 3 }]);
        expect(Number(o.totalAmount)).toBe(0.3);
        const row = await rawPrisma().order.findUniqueOrThrow({ where: { id: o.id } });
        expect(row.customerId).toBeTruthy();
        expect(row.publicToken).toBeTruthy();
        await expect(order([{ productId: foreign.id, quantity: 1 }])).rejects.toBeInstanceOf(OrderError);
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: foreign.id } })).stock).toBe(5);
    });
});

describe('order cancel and expiry (order-expiry.ts takes tx: any)', () => {
    it('staff cancels racing the expiry sweep return the stock exactly once', async () => {
        const tenantId = (await seedTenant()).id;
        const p = await rawPrisma().product.create({ data: { tenantId, name: 'Cake', price: 10, stock: 5 } });
        const o: any = await createOrderAtomic({
            prisma: await guardedPrisma(), tenantId, customerName: 'Kojo', customerPhone: '+233241234567', currency: 'GHS',
            items: [{ productId: p.id, quantity: 2 }],
        });
        await rawPrisma().order.update({
            where: { id: o.id },
            data: { paymentAuthorizationUrl: 'https://pay.example/x', createdAt: new Date(Date.now() - 3 * 3600_000) },
        });
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);

        const items = [{ productId: p.id, quantity: 2 }];
        const { ok, failed } = await race(8, async (i) => i % 2 === 0
            ? cancelOrderAndRestock(await guardedPrisma(), { tenantId, orderId: o.id, items, guard: { status: { notIn: ['CANCELLED', 'DELIVERED'] } } })
            : expireUnpaidOrders(rawPrisma() as any, undefined, new Date(), 60).then((n) => n > 0));
        expect(failed.map((e) => String(e?.message ?? e).slice(0, 100))).toEqual([]);
        expect(ok.filter(Boolean)).toHaveLength(1);
        expect((await rawPrisma().product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
        expect((await rawPrisma().order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CANCELLED');
    });
});

describe('admin needs-attention query', () => {
    it('every section answers against the real schema (the section() wrapper would otherwise hide a bad column as "unavailable")', async () => {
        const prisma = await guardedPrisma();
        const t = await seedTenant({ monthlyMessageQuotaOverride: 10 });
        const userId = (await seedUser(t.id)).id;
        const svc = await seedService(t.id);
        await raiseAlert(prisma, { kind: 'x.test', severity: 'critical', tenantId: t.id, message: 'boom', dedupeKey: 'x.test:1' });
        await raiseAlert(prisma, { kind: 'y.test', severity: 'warning', tenantId: t.id, message: 'hmm', dedupeKey: 'y.test:1' });
        await seedPayoutRecipient(t.id);
        const wallet = await seedFundedWallet(t.id, { availableMinor: 5000 });
        await rawPrisma().payoutRequest.create({
            data: { tenantId: t.id, walletId: wallet.id, amountMinor: 1000, status: 'PROCESSING', recipientId: (await rawPrisma().payoutRecipient.findFirstOrThrow()).id, requestedByUserId: userId, createdAt: new Date(Date.now() - 3 * 3600_000) },
        });
        const b = await seedBooking(t.id, svc.id, { status: 'CANCELLED', paymentStatus: 'PAID' });
        await rawPrisma().$executeRaw`UPDATE "Booking" SET "depositState" = 'REFUND_PENDING', "refundAttempts" = 3, "refundNextAttemptAt" = now(), "refundLastError" = 'x' WHERE id = ${b.id}`;
        await seedConversation(t.id, { state: 'HUMAN_ACTIVE', takeoverAt: new Date(Date.now() - 60 * 60_000), takeoverReason: 'asked' });
        const sub = await rawPrisma().webhookSubscription.create({ data: { tenantId: t.id, url: 'https://example.test/h', events: ['*'], secretEnc: 'x' } });
        const ev = await rawPrisma().domainEvent.create({ data: { tenantId: t.id, type: 'a.b', payload: {} } });
        await rawPrisma().webhookDelivery.create({ data: { tenantId: t.id, subscriptionId: sub.id, eventId: ev.id, status: 'FAILED' } });
        const usageTenant = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: t.id } });
        const { currentCycleKey } = await import('../../src/services/usage.js');
        await rawPrisma().tenantUsage.create({ data: { tenantId: t.id, month: currentCycleKey(usageTenant), messageCount: 9 } });

        const result: any = await buildAttention(prisma, { handoffMinutes: 15, quotaPercent: 80, includeMoney: true });
        for (const name of ['alerts', 'payouts', 'refunds', 'whatsapp', 'quota', 'handoffs', 'webhooks']) {
            expect(result[name], name).not.toBeNull();
            expect(result[name]?.error, `section ${name} failed`).toBeUndefined();
        }
        expect(result.alerts.bySeverity).toMatchObject({ critical: 1, warning: 1 });
    });
});

describe('flow.completed event (flow-events.ts takes prisma: unknown)', () => {
    it('is written to DomainEvent with the documented payload when a subscriber exists', async () => {
        const { emitFlowCompleted } = await import('../../src/services/flow-events.js');
        const prisma = await guardedPrisma();
        const t = await seedTenant();
        const conv = await seedConversation(t.id);
        await rawPrisma().webhookSubscription.create({ data: { tenantId: t.id, url: 'https://example.test/h', events: ['flow.completed'], secretEnc: 'x' } });
        await emitFlowCompleted(prisma, { tenantId: t.id, conversationId: conv.id, completion: { flowKey: 'rides', version: 2, vars: { dest: 'Legon' } } as never });
        const ev = await rawPrisma().domainEvent.findFirstOrThrow({ where: { tenantId: t.id, type: 'flow.completed' } });
        expect(ev.payload).toMatchObject({ v: 1, flowKey: 'rides', version: 2, conversationId: conv.id, customerId: null, vars: { dest: 'Legon' } });
        expect(await rawPrisma().webhookDelivery.count({ where: { tenantId: t.id } })).toBe(1);
    });
});
