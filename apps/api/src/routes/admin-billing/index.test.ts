import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import adminBillingRoutes from './index.js';
import { BILLING_LIMITS } from '../../services/billing-usage.js';
import * as publish from '../../services/events/publish.js';
import { clearSwitchCache } from '../../services/platform-switches.js';

const state = {
    role: 'OWNER' as string | null,
    totp: true,
    require2fa: false,
    authed: true,
    audits: [] as any[],
    terms: null as any,
    events: 0,
};

const tenantRow = { id: 't1', name: 'Acme', vertical: 'RIDES', planId: 'pro', timezone: 'Pacific/Auckland', isActive: true };

const prisma: any = {
    platformSetting: { findUnique: vi.fn(async () => (state.require2fa ? { value: { enabled: true } } : null)) },
    tenant: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === 't1' ? tenantRow : null)),
        findMany: vi.fn(async () => [{ ...tenantRow, billingTerms: state.terms }]),
    },
    billingTerms: {
        findUnique: vi.fn(async () => state.terms),
        upsert: vi.fn(async ({ create, update }: any) => {
            state.terms = { ...(state.terms ?? { createdAt: new Date('2026-01-05T00:00:00Z') }), ...(state.terms ? update : create), updatedAt: new Date() };
            return state.terms;
        }),
    },
    domainEvent: { count: vi.fn(async () => state.events) },
    auditLog: { create: vi.fn(async (a: any) => { state.audits.push(a.data); return {}; }), findMany: vi.fn(async () => []) },
};

let app: FastifyInstance;
beforeAll(async () => {
    app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticateAdmin', async (request: any) => {
        if (!state.authed) throw app.httpErrors.unauthorized('no');
        // What the real authenticateAdmin provides: the role comes from the row.
        request.admin = { adminId: 'admin-1', isSuperAdmin: false, role: (state.role ?? 'UNKNOWN') as any, totpEnabled: state.totp };
    });
    await app.register(adminBillingRoutes, { prefix: '/admin/billing' });
    await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
    state.role = 'OWNER'; state.authed = true; state.audits.length = 0; state.events = 0;
    state.totp = true; state.require2fa = false;
    clearSwitchCache();
    state.terms = null;
    vi.clearAllMocks();
});

const goodTerms = { currency: 'GHS', setupFeeMinor: 200_000, monthlyFeeMinor: 50_000, unitPriceMinor: 25, unitEventType: 'flow.completed', notes: 'pilot' };
const put = (payload: unknown, id = 't1') => app.inject({ method: 'PUT', url: `/admin/billing/tenants/${id}/terms`, payload: payload as any });

describe('authentication', () => {
    it('401s every route without an admin session', async () => {
        state.authed = false;
        for (const [method, url] of [
            ['GET', '/admin/billing/event-types'], ['GET', '/admin/billing/tenants'],
            ['GET', '/admin/billing/tenants/t1/terms'], ['PUT', '/admin/billing/tenants/t1/terms'],
            ['GET', '/admin/billing/tenants/t1/statement'], ['GET', '/admin/billing/tenants/t1/statement.csv'],
        ] as const) {
            const res = await app.inject({ method, url, payload: method === 'PUT' ? goodTerms : undefined });
            expect(res.statusCode, `${method} ${url}`).toBe(401);
        }
        expect(prisma.billingTerms.upsert).not.toHaveBeenCalled();
    });
});

describe('PUT terms permissions', () => {
    it.each(['OWNER', 'FINANCE'])('%s may edit', async (role) => {
        state.role = role;
        const res = await put(goodTerms);
        expect(res.statusCode).toBe(200);
        expect(prisma.billingTerms.upsert).toHaveBeenCalledTimes(1);
    });
    it.each(['SUPPORT', 'READONLY', 'WEIRD', null])('%s may not edit (403, nothing written)', async (role) => {
        state.role = role as string | null;
        const res = await put(goodTerms);
        expect(res.statusCode).toBe(403);
        expect(prisma.billingTerms.upsert).not.toHaveBeenCalled();
        expect(state.audits).toHaveLength(0);
    });
    it.each(['OWNER', 'FINANCE', 'SUPPORT', 'READONLY'])('%s may read terms, statements and csv', async (role) => {
        state.role = role;
        for (const url of ['/admin/billing/tenants/t1/terms', '/admin/billing/tenants/t1/statement', '/admin/billing/tenants/t1/statement.csv', '/admin/billing/tenants', '/admin/billing/event-types']) {
            expect((await app.inject({ method: 'GET', url })).statusCode, `${role} ${url}`).toBe(200);
        }
    });
    it('reports canEdit per role', async () => {
        state.role = 'FINANCE';
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants/t1/terms' })).json().canEdit).toBe(true);
        state.role = 'SUPPORT';
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants/t1/terms' })).json().canEdit).toBe(false);
    });
    it('shares the admin guard: the 2-factor requirement applies to billing like every other admin route', async () => {
        state.require2fa = true;
        state.totp = false;
        for (const [method, url] of [['GET', '/admin/billing/tenants'], ['PUT', '/admin/billing/tenants/t1/terms']] as const) {
            const res = await app.inject({ method, url, payload: method === 'PUT' ? goodTerms : undefined });
            expect(res.statusCode, `${method} ${url}`).toBe(403);
            expect(res.json().message).toMatch(/two-factor/i);
        }
        expect(prisma.billingTerms.upsert).not.toHaveBeenCalled();
        state.totp = true;
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants' })).statusCode).toBe(200);
    });
    it('READONLY is refused the write by the shared GET-only rule as well as by the permission', async () => {
        state.role = 'READONLY';
        expect((await put(goodTerms)).statusCode).toBe(403);
    });
});

describe('PUT terms', () => {
    it('saves, audits with the acting admin, and clears the publish cache', async () => {
        const spy = vi.spyOn(publish, 'clearBillingUnitCache');
        const res = await put(goodTerms);
        expect(res.statusCode).toBe(200);
        expect(res.json().terms).toMatchObject({ currency: 'GHS', monthlyFeeMinor: 50_000, unitEventType: 'flow.completed' });
        expect(prisma.billingTerms.upsert.mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1' }, create: { tenantId: 't1' } });
        expect(state.audits[0]).toMatchObject({ action: 'billing.terms.updated', actorType: 'ADMIN', actorId: 'admin-1', tenantId: 't1' });
        expect(spy).toHaveBeenCalledWith('t1');
    });
    it('takes tenantId from the path only, never the body', async () => {
        expect((await put({ ...goodTerms, tenantId: 't2' })).statusCode).toBe(400);
    });
    it('400s invalid money, currency, unit type, caps; nothing written', async () => {
        const bad = [
            { ...goodTerms, monthlyFeeMinor: 1.5 }, { ...goodTerms, setupFeeMinor: -1 },
            { ...goodTerms, unitPriceMinor: BILLING_LIMITS.maxUnitPriceMinor + 1 },
            { ...goodTerms, currency: 'ghs' }, { ...goodTerms, unitEventType: 'not.in.catalogue' }, {},
        ];
        for (const b of bad) expect((await put(b)).statusCode).toBe(400);
        expect(prisma.billingTerms.upsert).not.toHaveBeenCalled();
    });
    it('404 for an unknown organisation', async () => {
        expect((await put(goodTerms, 'nope')).statusCode).toBe(404);
        expect(prisma.billingTerms.upsert).not.toHaveBeenCalled();
    });
    it('a second PUT replaces (omitted unit type becomes null) and keeps createdAt', async () => {
        await put(goodTerms);
        const created = state.terms.createdAt;
        const res = await put({ currency: 'GHS', setupFeeMinor: 0, monthlyFeeMinor: 0, unitPriceMinor: 0 });
        expect(res.statusCode).toBe(200);
        expect(state.terms.unitEventType).toBeNull();
        expect(state.terms.createdAt).toBe(created);
    });
});

describe('statement', () => {
    beforeEach(() => { state.terms = { ...goodTerms, createdAt: new Date('2026-01-05T00:00:00Z'), updatedAt: new Date() }; });

    it('returns line items for a month, counting the unit event for that tenant', async () => {
        state.events = 10;
        const res = await app.inject({ method: 'GET', url: '/admin/billing/tenants/t1/statement?month=2026-03' });
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j.period).toMatchObject({ month: '2026-03', timezone: 'Pacific/Auckland' });
        expect(j.lines.map((l: any) => l.code)).toEqual(['monthly_fee', 'usage']);
        expect(j.totalMinor).toBe(50_000 + 10 * 25);
        expect(prisma.domainEvent.count.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', type: 'flow.completed' });
    });
    it('400s a malformed or future month, 404s an unknown tenant', async () => {
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants/t1/statement?month=2026-13' })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants/t1/statement?month=2999-01' })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants/nope/statement?month=2026-03' })).statusCode).toBe(404);
    });
    it('csv is text/csv, an attachment, uncached, with the total', async () => {
        const res = await app.inject({ method: 'GET', url: '/admin/billing/tenants/t1/statement.csv?month=2026-03' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/csv/);
        expect(res.headers['content-disposition']).toBe('attachment; filename="statement-t1-2026-03.csv"');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toContain('Monthly fee,1,500.00,500.00,GHS');
        expect(res.body.trimEnd().split('\r\n').at(-1)).toBe('Total,,,500.00,GHS');
    });
});

describe('catalogue and list', () => {
    it('lists catalogue event types, flagging the high-volume ones', async () => {
        const data = (await app.inject({ method: 'GET', url: '/admin/billing/event-types' })).json().data;
        expect(data.find((e: any) => e.type === 'flow.completed')).toMatchObject({ highVolume: false });
        expect(data.find((e: any) => e.type === 'message.sent')).toMatchObject({ highVolume: true });
        expect(data.some((e: any) => e.type === 'webhook.test')).toBe(false);
    });
    it('lists organisations with their terms (or null) and caps the limit', async () => {
        const res = await app.inject({ method: 'GET', url: '/admin/billing/tenants?search=ac' });
        expect(res.json().data[0]).toMatchObject({ id: 't1', terms: null });
        expect(prisma.tenant.findMany.mock.calls[0][0].where).toEqual({ name: { contains: 'ac', mode: 'insensitive' } });
        expect((await app.inject({ method: 'GET', url: '/admin/billing/tenants?limit=999' })).statusCode).toBe(400);
    });
});
