import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import moneyRoutes, { buildMoneyOverview } from './money.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

const NOW = new Date('2026-10-06T12:00:00Z');

function scripted() {
    const p = makePrisma();
    p.wallet.groupBy.mockResolvedValue([
        { currency: 'GHS', _sum: { cachedAvailableMinor: 120000, cachedPendingMinor: 30000 }, _count: { _all: 7 } },
        { currency: 'NGN', _sum: { cachedAvailableMinor: 5000, cachedPendingMinor: null }, _count: { _all: 1 } },
    ]);
    p.payoutRequest.groupBy.mockResolvedValue([
        { status: 'PAID', currency: 'GHS', _count: { _all: 10 }, _sum: { amountMinor: 90000 } },
        { status: 'FAILED', currency: 'GHS', _count: { _all: 2 }, _sum: { amountMinor: 4000 } },
    ]);
    p.booking.groupBy.mockResolvedValue([
        { depositState: 'REFUND_PENDING', _count: { _all: 3 } },
        { depositState: 'REFUNDED', _count: { _all: 11 } },
    ]);
    p.ledgerEntry.groupBy.mockResolvedValue([{ currency: 'GHS', _sum: { amountMinor: 2500 } }]);
    return p;
}

describe('buildMoneyOverview', () => {
    it('balances by currency, payouts by status+currency, refunds by state, fees', async () => {
        const p = scripted();
        const r: any = await buildMoneyOverview(p as any, NOW);
        expect(r.balances).toEqual([
            { currency: 'GHS', availableMinor: 120000, pendingMinor: 30000, wallets: 7 },
            { currency: 'NGN', availableMinor: 5000, pendingMinor: 0, wallets: 1 },
        ]);
        expect(r.payouts).toEqual([
            { status: 'PAID', currency: 'GHS', count: 10, totalMinor: 90000 },
            { status: 'FAILED', currency: 'GHS', count: 2, totalMinor: 4000 },
        ]);
        expect(r.refunds).toEqual({ pending: 3, refunding: 0, refunded: 11 });
        expect(r.fees).toEqual({ windowDays: 30, byCurrency: [{ currency: 'GHS', totalMinor: 2500 }] });
        expect(r.note).toMatch(/cached/i);
    });

    it('fees: only the PLATFORM_FEE account, only the last 30 days', async () => {
        const p = scripted();
        await buildMoneyOverview(p as any, NOW);
        const where = p.ledgerEntry.groupBy.mock.calls[0][0].where;
        expect(where.account).toBe('PLATFORM_FEE');
        expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 30 * 86400_000));
    });

    it('refunds query only considers refund states', async () => {
        const p = scripted();
        await buildMoneyOverview(p as any, NOW);
        expect(p.booking.groupBy.mock.calls[0][0].where).toEqual({ depositState: { in: ['REFUND_PENDING', 'REFUNDING', 'REFUNDED'] } });
    });
});

describe('money routes', () => {
    async function build() {
        prisma = scripted();
        app = await buildAdminTestApp(async (s) => { await s.register(moneyRoutes); }, { prisma });
    }
    const get = (url: string, headers: any) => app.inject({ method: 'GET', url, headers });

    it.each(['OWNER', 'FINANCE', 'READONLY'])('%s can read money oversight', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        expect((await get('/admin/money/overview', headers)).statusCode).toBe(200);
        expect((await get('/admin/money/payouts', headers)).statusCode).toBe(200);
        expect((await get('/admin/money/refunds', headers)).statusCode).toBe(200);
    });

    it('SUPPORT cannot see money at all', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        for (const url of ['/admin/money/overview', '/admin/money/payouts', '/admin/money/refunds']) {
            expect((await get(url, headers)).statusCode).toBe(403);
        }
        expect(prisma.wallet.groupBy).not.toHaveBeenCalled();
    });

    it('there is no way to change money here: every non-GET verb is 404 (route does not exist)', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const res = await app.inject({ method: method as any, url: '/admin/money/payouts', headers, payload: {} });
            expect(res.statusCode).toBe(404);
        }
    });

    it('payouts list: filtered, paginated, bounded, recipient masked, never the encrypted number', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'FINANCE');
        prisma.payoutRequest.count.mockResolvedValue(41);
        prisma.payoutRequest.findMany.mockResolvedValue([
            { id: 'p1', tenantId: 't1', amountMinor: 5000, currency: 'GHS', status: 'FAILED', failureReason: 'x', createdAt: NOW, updatedAt: NOW, settledAt: null, providerRef: 'TRF_1',
              recipient: { accountName: 'Ama K', accountNumberMasked: '024 ••• 4567', type: 'mobile_money', bankCode: 'MTN' } },
        ]);
        prisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'Swift Rides' }]);
        const res = await get('/admin/money/payouts?status=FAILED&tenantId=t1&page=2&limit=20', headers);
        expect(res.statusCode).toBe(200);
        const args = prisma.payoutRequest.findMany.mock.calls[0][0];
        expect(args.where).toEqual({ status: 'FAILED', tenantId: 't1' });
        expect(args.skip).toBe(20);
        expect(args.take).toBe(20);
        expect(args.select.recipient.select.accountNumberEnc).toBeUndefined();
        const j = res.json();
        expect(j.pagination).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
        expect(j.data[0]).toMatchObject({ id: 'p1', tenantName: 'Swift Rides', recipient: { accountNumberMasked: '024 ••• 4567' } });
    });

    it('payouts: rejects a bad status and an oversize limit', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'FINANCE');
        expect((await get('/admin/money/payouts?status=NOPE', headers)).statusCode).toBe(400);
        expect((await get('/admin/money/payouts?limit=1000', headers)).statusCode).toBe(400);
    });

    it('refunds list: defaults to those awaiting retry, with attempts and last error', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'FINANCE');
        prisma.booking.count.mockResolvedValue(1);
        prisma.booking.findMany.mockResolvedValue([
            { id: 'b1', tenantId: 't1', bookingReference: 'BK-1', depositAmount: '50.00', refundAttempts: 3, refundLastError: 'timeout', refundNextAttemptAt: NOW, depositState: 'REFUND_PENDING', updatedAt: NOW },
        ]);
        prisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'Swift Rides' }]);
        const res = await get('/admin/money/refunds', headers);
        expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({ depositState: 'REFUND_PENDING' });
        expect(res.json().data[0]).toMatchObject({ bookingId: 'b1', reference: 'BK-1', attempts: 3, lastError: 'timeout', tenantName: 'Swift Rides' });
        expect(prisma.booking.findMany.mock.calls[0][0].select.customerPhone).toBeUndefined();
    });
});
