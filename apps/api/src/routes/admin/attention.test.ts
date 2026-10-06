import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import attentionRoutes, { buildAttention } from './attention.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

const NOW = new Date('2026-10-06T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function scripted() {
    const p = makePrisma();
    p.platformAlert.groupBy.mockResolvedValue([
        { severity: 'critical', _count: { _all: 2 } },
        { severity: 'warning', _count: { _all: 5 } },
    ]);
    p.platformAlert.findMany.mockImplementation(async ({ where }: any) =>
        where.severity === 'critical'
            ? [{ id: 'a1', tenantId: 't1', kind: 'payout.failed', severity: 'critical', message: 'boom', count: 3, lastSeenAt: NOW }]
            : [{ id: 'a2', tenantId: null, kind: 'inbound.failed', severity: 'warning', message: 'slow', count: 1, lastSeenAt: NOW }]);
    p.tenant.findMany.mockImplementation(async ({ where }: any) => {
        if (where?.id?.in) return where.id.in.map((id: string) => ({ id, name: `Org ${id}` }));
        return [];
    });
    return p;
}

describe('buildAttention', () => {
    it('summarises open alerts by severity with critical first and tenant names attached', async () => {
        const p = scripted();
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: true, now: NOW });
        expect(r.alerts.bySeverity).toEqual({ critical: 2, warning: 5, info: 0 });
        expect(r.alerts.total).toBe(7);
        expect(r.alerts.top.map((a: any) => a.id)).toEqual(['a1', 'a2']);
        expect(r.alerts.top[0].tenantName).toBe('Org t1');
        expect(r.alerts.top[1].tenantName).toBeNull();
    });

    it('queries only OPEN alerts', async () => {
        const p = scripted();
        await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: true, now: NOW });
        expect(p.platformAlert.groupBy.mock.calls[0][0].where).toEqual({ resolvedAt: null });
        for (const c of p.platformAlert.findMany.mock.calls) expect(c[0].where.resolvedAt).toBeNull();
    });

    it('failed and stuck payouts, and refunds awaiting retry, appear for money roles', async () => {
        const p = scripted();
        p.payoutRequest.count.mockImplementation(async ({ where }: any) => (where.status === 'FAILED' ? 2 : 1));
        p.payoutRequest.findMany.mockResolvedValue([
            { id: 'p1', tenantId: 't1', amountMinor: 5000, currency: 'GHS', status: 'FAILED', failureReason: 'bad account', updatedAt: NOW },
        ]);
        p.booking.count.mockResolvedValue(4);
        p.booking.findMany.mockResolvedValue([
            { id: 'b1', tenantId: 't2', refundAttempts: 3, refundLastError: 'timeout', refundNextAttemptAt: NOW },
        ]);
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: true, now: NOW });
        expect(r.payouts).toMatchObject({ failed: 2, stuck: 1 });
        expect(r.payouts.items[0]).toMatchObject({ id: 'p1', tenantName: 'Org t1', failureReason: 'bad account' });
        expect(r.refunds).toMatchObject({ pending: 4 });
        expect(r.refunds.items[0]).toMatchObject({ bookingId: 'b1', attempts: 3, tenantName: 'Org t2' });
    });

    it('money sections are null (and not even queried) for roles without money access', async () => {
        const p = scripted();
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.payouts).toBeNull();
        expect(r.refunds).toBeNull();
        expect(p.payoutRequest.count).not.toHaveBeenCalled();
        expect(p.payoutRequest.findMany).not.toHaveBeenCalled();
    });

    it('WhatsApp numbers that are not live, and unapproved templates, per tenant', async () => {
        const p = scripted();
        p.tenant.findMany.mockImplementation(async ({ where }: any) => {
            if (where?.id?.in) return where.id.in.map((id: string) => ({ id, name: `Org ${id}` }));
            if (where?.whatsappPhoneNumberId) {
                return [{ id: 't3', name: 'Org t3', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappDisplayNumber: '+233200000000' }];
            }
            return [];
        });
        p.messageTemplate.findMany.mockResolvedValue([
            { tenantId: 't4', purpose: 'BOOKING_CONFIRMATION', name: 'bc', tenant: { name: 'Org t4' } },
            { tenantId: 't4', purpose: 'BOOKING_REMINDER', name: 'br', tenant: { name: 'Org t4' } },
        ]);
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.whatsapp.notLive).toEqual([{ tenantId: 't3', tenantName: 'Org t3', displayNumber: '+233200000000', reason: 'Number is added but not yet verified with Meta' }]);
        expect(r.whatsapp.unapprovedTemplates).toEqual([{ tenantId: 't4', tenantName: 'Org t4', count: 2, purposes: ['BOOKING_CONFIRMATION', 'BOOKING_REMINDER'] }]);
    });

    it('unanswered handoffs: waiting longer than N minutes with no human reply since', async () => {
        const p = scripted();
        p.conversation.findMany.mockResolvedValue([
            { id: 'c-old-unanswered', tenantId: 't1', customerName: 'Ama', customerPhone: '+233241234567', takeoverAt: minutesAgo(45), takeoverReason: 'asked for a person' },
            { id: 'c-old-answered', tenantId: 't1', customerName: 'Kofi', customerPhone: '+233241111111', takeoverAt: minutesAgo(60), takeoverReason: null },
        ]);
        p.message.groupBy.mockResolvedValue([{ conversationId: 'c-old-answered', _max: { createdAt: minutesAgo(50) } }]);
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.handoffs.olderThanMinutes).toBe(15);
        expect(r.handoffs.count).toBe(1);
        expect(r.handoffs.items[0]).toMatchObject({ conversationId: 'c-old-unanswered', waitingMinutes: 45, tenantName: 'Org t1' });
        // the phone is masked in this overview
        expect(r.handoffs.items[0].customer).not.toContain('2412345');
        // candidates are those taken over BEFORE the cutoff
        const where = p.conversation.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ state: 'HUMAN_ACTIVE' });
        expect(where.takeoverAt.lte).toEqual(minutesAgo(15));
        expect(p.conversation.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
    });

    it('a human reply AFTER the handoff clears it; one BEFORE does not', async () => {
        const p = scripted();
        p.conversation.findMany.mockResolvedValue([
            { id: 'c1', tenantId: 't1', customerName: null, customerPhone: null, takeoverAt: minutesAgo(30), takeoverReason: null },
        ]);
        p.message.groupBy.mockResolvedValue([{ conversationId: 'c1', _max: { createdAt: minutesAgo(40) } }]); // the bot's last message
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.handoffs.count).toBe(1);
    });

    it('tenants near their quota, highest first, with a truncation flag', async () => {
        const p = scripted();
        const anchor = new Date('2026-10-01T00:00:00Z');
        p.tenant.findMany.mockImplementation(async ({ where }: any) => {
            if (where?.id?.in) return where.id.in.map((id: string) => ({ id, name: `Org ${id}` }));
            if (where?.isActive === true && !where.whatsappPhoneNumberId) {
                return [
                    { id: 'q1', name: 'Org q1', planId: 'free', quotaCycleStart: anchor, createdAt: anchor, monthlyMessageQuotaOverride: null }, // 50 limit
                    { id: 'q2', name: 'Org q2', planId: 'free', quotaCycleStart: anchor, createdAt: anchor, monthlyMessageQuotaOverride: 100 },
                    { id: 'q3', name: 'Org q3', planId: 'free', quotaCycleStart: anchor, createdAt: anchor, monthlyMessageQuotaOverride: null },
                ];
            }
            return [];
        });
        p.tenantUsage.findMany.mockResolvedValue([
            { tenantId: 'q1', month: '2026-10-01', messageCount: 48 }, // 96%
            { tenantId: 'q2', month: '2026-10-01', messageCount: 85 }, // 85%
            { tenantId: 'q3', month: '2026-10-01', messageCount: 10 }, // 20%
        ]);
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.quota.nearLimit.map((q: any) => [q.tenantId, q.percent])).toEqual([['q1', 96], ['q2', 85]]);
        expect(r.quota.nearLimit[0]).toMatchObject({ used: 48, limit: 50, tenantName: 'Org q1' });
        expect(r.quota.truncated).toBe(false);
    });

    it('failed webhook deliveries in the last 24h, by tenant', async () => {
        const p = scripted();
        p.webhookDelivery.count.mockResolvedValue(9);
        p.webhookDelivery.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 6 } }, { tenantId: 't2', _count: { _all: 3 } }]);
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.webhooks).toMatchObject({ failedLast24h: 9 });
        expect(r.webhooks.byTenant).toEqual([
            { tenantId: 't1', tenantName: 'Org t1', count: 6 },
            { tenantId: 't2', tenantName: 'Org t2', count: 3 },
        ]);
        const where = p.webhookDelivery.count.mock.calls[0][0].where;
        expect(where.status).toBe('FAILED');
        expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 24 * 3600_000));
    });

    it('one failing section does not blank the page: it reports an error marker and the rest still load', async () => {
        const p = scripted();
        p.webhookDelivery.count.mockRejectedValue(new Error('db hiccup'));
        const r: any = await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: false, now: NOW });
        expect(r.webhooks).toEqual({ error: 'unavailable' });
        expect(r.alerts.total).toBe(7);
    });

    it('every list query is bounded', async () => {
        const p = scripted();
        await buildAttention(p as any, { handoffMinutes: 15, quotaPercent: 80, includeMoney: true, now: NOW });
        for (const model of ['platformAlert', 'payoutRequest', 'booking', 'tenant', 'messageTemplate', 'conversation', 'tenantUsage']) {
            for (const c of (p as any)[model].findMany.mock.calls) {
                expect(c[0].take, `${model}.findMany must have take`).toBeGreaterThan(0);
                expect(c[0].take).toBeLessThanOrEqual(1000);
            }
        }
        for (const c of p.webhookDelivery.groupBy.mock.calls) expect(c[0].take).toBeGreaterThan(0);
    });
});

describe('GET /admin/attention', () => {
    async function build() {
        prisma = scripted();
        app = await buildAdminTestApp(async (s) => { await s.register(attentionRoutes); }, { prisma });
    }
    it('SUPPORT gets the page without money sections', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const res = await app.inject({ method: 'GET', url: '/admin/attention', headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().payouts).toBeNull();
        expect(res.json().alerts.total).toBe(7);
    });
    it('FINANCE gets money sections', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'FINANCE');
        const res = await app.inject({ method: 'GET', url: '/admin/attention', headers });
        expect(res.json().payouts).not.toBeNull();
    });
    it('validates and clamps query params', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await app.inject({ method: 'GET', url: '/admin/attention?handoffMinutes=0', headers })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/attention?quotaPercent=500', headers })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/attention?handoffMinutes=30&quotaPercent=90', headers })).statusCode).toBe(200);
    });
    it('401 without a token', async () => {
        await build();
        expect((await app.inject({ method: 'GET', url: '/admin/attention' })).statusCode).toBe(401);
    });
});
