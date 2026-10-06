import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import messagingRoutes, { buildMessagingHealth, deliveryStats } from './messaging.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

const NOW = new Date('2026-10-06T12:00:00Z');
const anchor = new Date('2026-10-01T00:00:00Z');

describe('deliveryStats', () => {
    it('failure rate is failed / (messages with a receipt), no-receipt reported separately', () => {
        const s = deliveryStats({ SENT: 10, DELIVERED: 60, READ: 20, FAILED: 10, none: 40 });
        expect(s).toMatchObject({ total: 140, sent: 10, delivered: 60, read: 20, failed: 10, noReceipt: 40 });
        expect(s.failureRate).toBeCloseTo(10 / 100, 5);
        expect(s.deliveryRate).toBeCloseTo(80 / 100, 5);
    });
    it('zero receipts means null rates, not NaN', () => {
        const s = deliveryStats({ none: 5 });
        expect(s.failureRate).toBeNull();
        expect(s.deliveryRate).toBeNull();
        expect(deliveryStats({}).total).toBe(0);
    });
});

function scripted() {
    const p = makePrisma();
    p.$queryRaw.mockResolvedValue([
        { tenantId: 't1', status: 'DELIVERED', n: 90 },
        { tenantId: 't1', status: 'FAILED', n: 10 },
        { tenantId: 't2', status: 'DELIVERED', n: 40 },
        { tenantId: 't2', status: 'READ', n: 10 },
        { tenantId: 't3', status: 'FAILED', n: 4 },
        { tenantId: 't3', status: null, n: 1 },
    ]);
    p.tenant.findMany.mockImplementation(async ({ where }: any) => {
        if (where?.id?.in) return where.id.in.map((id: string) => ({ id, name: `Org ${id}`, quotaCycleStart: anchor, createdAt: anchor }));
        return [];
    });
    p.message.groupBy.mockResolvedValue([
        { billingCategory: 'utility', billable: true, _count: { _all: 30 } },
        { billingCategory: 'service', billable: false, _count: { _all: 100 } },
        { billingCategory: 'marketing', billable: true, _count: { _all: 5 } },
    ]);
    p.tenantUsage.findMany.mockResolvedValue([
        { tenantId: 't1', month: '2026-10-01', platformSmsCount: 190 },
        { tenantId: 't2', month: '2026-09-01', platformSmsCount: 500 }, // an older cycle: ignored
        { tenantId: 't3', month: '2026-10-01', platformSmsCount: 20 },
    ]);
    return p;
}

describe('buildMessagingHealth', () => {
    it('per-tenant delivery and failure rates, worst first, with tenant names', async () => {
        const p = scripted();
        const r: any = await buildMessagingHealth(p as any, { days: 7, minVolume: 1, now: NOW });
        expect(r.tenants.map((t: any) => t.tenantId)).toEqual(['t3', 't1', 't2']);
        expect(r.tenants[0]).toMatchObject({ tenantId: 't3', tenantName: 'Org t3', failed: 4, noReceipt: 1, failureRate: 1 });
        expect(r.tenants[1]).toMatchObject({ tenantId: 't1', failureRate: 0.1 });
        expect(r.tenants[2]).toMatchObject({ tenantId: 't2', failureRate: 0 });
        expect(r.totals).toMatchObject({ total: 155, failed: 14 });
        expect(r.windowDays).toBe(7);
    });

    it('minVolume hides low-volume tenants from the table (but not from totals)', async () => {
        const p = scripted();
        const r: any = await buildMessagingHealth(p as any, { days: 7, minVolume: 20, now: NOW });
        expect(r.tenants.map((t: any) => t.tenantId)).toEqual(['t1', 't2']);
        expect(r.totals.total).toBe(155);
    });

    it('the raw query is windowed to outbound messages since the cutoff', async () => {
        const p = scripted();
        await buildMessagingHealth(p as any, { days: 3, minVolume: 1, now: NOW });
        const call = p.$queryRaw.mock.calls[0];
        const sql = (call[0] as string[]).join('?');
        expect(sql).toMatch(/OUTBOUND/);
        expect(sql).toMatch(/LIMIT/i);
        expect(call.slice(1)).toContainEqual(new Date(NOW.getTime() - 3 * 86_400_000));
    });

    it('Meta billing categories: counts and billable counts, outbound in the window only', async () => {
        const p = scripted();
        const r: any = await buildMessagingHealth(p as any, { days: 7, minVolume: 1, now: NOW });
        expect(r.billing).toEqual([
            { category: 'service', total: 100, billable: 0, free: 100 },
            { category: 'utility', total: 30, billable: 30, free: 0 },
            { category: 'marketing', total: 5, billable: 5, free: 0 },
        ]);
        const where = p.message.groupBy.mock.calls[0][0].where;
        expect(where).toMatchObject({ direction: 'OUTBOUND', billingCategory: { not: null } });
        expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 7 * 86_400_000));
    });

    it('SMS usage against the per-tenant budget, current cycle only, highest share first', async () => {
        const p = scripted();
        const r: any = await buildMessagingHealth(p as any, { days: 7, minVolume: 1, now: NOW });
        expect(r.sms.budgetPerTenant).toBe(200);
        expect(r.sms.tenants).toEqual([
            { tenantId: 't1', tenantName: 'Org t1', used: 190, budget: 200, percent: 95 },
            { tenantId: 't3', tenantName: 'Org t3', used: 20, budget: 200, percent: 10 },
        ]);
        expect(r.sms.totalUsed).toBe(210);
    });

    it('bounded queries', async () => {
        const p = scripted();
        await buildMessagingHealth(p as any, { days: 7, minVolume: 1, now: NOW });
        expect(p.tenantUsage.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(500);
    });
});

describe('GET /admin/messaging/health', () => {
    async function build() {
        prisma = scripted();
        app = await buildAdminTestApp(async (s) => { await s.register(messagingRoutes); }, { prisma });
    }
    it('every role may read it; validates days', async () => {
        await build();
        for (const role of ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY']) {
            const { headers } = signedInAs(app, prisma, role);
            expect((await app.inject({ method: 'GET', url: '/admin/messaging/health', headers })).statusCode).toBe(200);
        }
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await app.inject({ method: 'GET', url: '/admin/messaging/health?days=0', headers })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/messaging/health?days=91', headers })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/messaging/health?days=14', headers })).statusCode).toBe(200);
    });
});
