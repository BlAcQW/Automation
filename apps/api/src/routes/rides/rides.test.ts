import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({
    overview: vi.fn(), liveRides: vi.fn(), rideHistory: vi.fn(), customerList: vi.fn(), customerDetail: vi.fn(), passList: vi.fn(), paymentList: vi.fn(),
    assignRideDriver: vi.fn(), changeRideStatus: vi.fn(), getRideSettings: vi.fn(), updateRideSettings: vi.fn(), resolveMaskPolicy: vi.fn(),
}));
vi.mock('../../services/rides/console.js', () => ({
    overview: m.overview, liveRides: m.liveRides, rideHistory: m.rideHistory, customerList: m.customerList,
    customerDetail: m.customerDetail, passList: m.passList, paymentList: m.paymentList,
}));
vi.mock('../../services/rides/operations.js', () => ({ assignRideDriver: m.assignRideDriver, changeRideStatus: m.changeRideStatus }));
vi.mock('../../services/rides/settings.js', async (orig) => ({ ...(await orig<object>()), getRideSettings: m.getRideSettings, updateRideSettings: m.updateRideSettings }));
vi.mock('../../services/contact-privacy-policy.js', () => ({ resolveMaskPolicy: m.resolveMaskPolicy }));

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import errorHandler from '../../plugins/error-handler.js';
import ridesRoutes from './index.js';
import { resolveSettings } from '../../services/rides/settings.js';

const now = new Date('2026-10-06T12:00:00Z');
const ride = {
    id: 'r1', ref: 'TR-1', kind: 'PACKAGE', status: 'ASSIGNED', pickupLabel: 'Gate', pickupLat: 1, pickupLng: 2, destinationLabel: 'Lib', destinationLat: 3, destinationLng: 4,
    distanceKm: 1.2, fareMinor: 0, requestedAt: now, assignedAt: now, completedAt: null, cancelledAt: null, cancelReason: null,
    customer: { id: 'c1', name: 'Ama', phone: '+233241234567' }, driver: { id: 'd1', name: 'Kofi', vehicle: 'Vitz', plate: 'GR 1', phone: '+233200000000' },
};
const rows: Record<string, any[]> = { driver: [], rideDestination: [] };
const prisma: any = {
    driver: {
        findMany: vi.fn(async () => rows.driver),
        create: vi.fn(async ({ data }: any) => { const r = { id: `d${rows.driver.length + 1}`, ...data }; rows.driver.push(r); return r; }),
        updateMany: vi.fn(async ({ where, data }: any) => { const r = rows.driver.find((x) => x.id === where.id && x.tenantId === where.tenantId); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
        findFirst: vi.fn(async ({ where }: any) => rows.driver.find((x) => x.id === where.id && x.tenantId === where.tenantId) ?? null),
    },
    rideDestination: {
        findMany: vi.fn(async () => rows.rideDestination),
        create: vi.fn(async ({ data }: any) => { const r = { id: 'x1', ...data }; rows.rideDestination.push(r); return r; }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findFirst: vi.fn(async () => null),
    },
    auditLog: { create: vi.fn(async () => ({})) },
};

let app: FastifyInstance;
const as = (role: 'OWNER' | 'STAFF', tenantId = 't1') => ({ 'x-test-user': JSON.stringify({ userId: 'u1', tenantId, role }) });

beforeEach(async () => {
    vi.clearAllMocks();
    rows.driver = []; rows.rideDestination = [];
    m.resolveMaskPolicy.mockImplementation(async (_p: unknown, _t: string, role: string) => role !== 'OWNER');
    m.getRideSettings.mockResolvedValue(resolveSettings(null));
    app = Fastify();
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(fp(async (a) => {
        a.decorate('prisma', prisma);
        a.decorate('authenticate', async (request: FastifyRequest) => {
            const raw = request.headers['x-test-user'];
            if (typeof raw !== 'string') throw a.httpErrors.unauthorized('Invalid or expired token');
            (request as any).user = JSON.parse(raw);
        });
    }));
    await app.register(ridesRoutes, { prefix: '/rides' });
    await app.ready();
});
afterEach(() => app.close());

describe('auth', () => {
    it('every route needs a staff login', async () => {
        for (const url of ['/rides/overview', '/rides/live', '/rides', '/rides/customers', '/rides/passes', '/rides/payments', '/rides/drivers', '/rides/destinations', '/rides/settings']) {
            expect((await app.inject({ url })).statusCode, url).toBe(401);
        }
    });
});

describe('read routes pass the tenant, the mask and validated filters to the queries', () => {
    it('overview is the bare object', async () => {
        m.overview.mockResolvedValue({ packages: { sold: 1 } });
        const r = await app.inject({ url: '/rides/overview', headers: as('STAFF') });
        expect(r.json()).toEqual({ packages: { sold: 1 } });
        expect(m.overview).toHaveBeenCalledWith(prisma, 't1');
    });

    it('live: optional status, masked for staff', async () => {
        m.liveRides.mockResolvedValue({ data: [], pagination: {} });
        await app.inject({ url: '/rides/live?status=REQUESTED', headers: as('STAFF') });
        expect(m.liveRides).toHaveBeenCalledWith(prisma, 't1', 'REQUESTED', true);
        await app.inject({ url: '/rides/live?status=', headers: as('OWNER') });
        expect(m.liveRides).toHaveBeenLastCalledWith(prisma, 't1', undefined, false);
        expect((await app.inject({ url: '/rides/live?status=COMPLETED', headers: as('STAFF') })).statusCode).toBe(400);
    });

    it('history: dates become a whole-day window in the tenant timezone; bad filters are 400', async () => {
        m.rideHistory.mockResolvedValue({ data: [], pagination: { page: 2, limit: 20, total: 0, totalPages: 0 } });
        const r = await app.inject({ url: '/rides?from=2026-10-01&to=2026-10-01&status=COMPLETED&kind=PAYG&page=2', headers: as('OWNER') });
        expect(r.statusCode).toBe(200);
        const q = m.rideHistory.mock.calls[0][2];
        expect(q).toMatchObject({ page: 2, limit: 20, status: 'COMPLETED', kind: 'PAYG' });
        expect(q.from.toISOString()).toBe('2026-10-01T00:00:00.000Z'); // Accra is UTC+0
        expect(q.to.toISOString()).toBe('2026-10-02T00:00:00.000Z');
        expect((await app.inject({ url: '/rides?status=PENDING_PAYMENT', headers: as('OWNER') })).statusCode).toBe(400);
        expect((await app.inject({ url: '/rides?from=yesterday', headers: as('OWNER') })).statusCode).toBe(400);
        expect((await app.inject({ url: '/rides?page=0', headers: as('OWNER') })).statusCode).toBe(400);
    });

    it('customers, customer detail (404), passes and payments filters', async () => {
        m.customerList.mockResolvedValue({ data: [], pagination: {} });
        await app.inject({ url: '/rides/customers?search=Ama&page=1', headers: as('STAFF') });
        expect(m.customerList).toHaveBeenCalledWith(prisma, 't1', { search: 'Ama', page: 1, limit: 20 }, true);
        m.customerDetail.mockResolvedValue(null);
        expect((await app.inject({ url: '/rides/customers/c9', headers: as('STAFF') })).statusCode).toBe(404);
        m.passList.mockResolvedValue({ data: [], pagination: {} });
        await app.inject({ url: '/rides/passes?status=EXHAUSTED', headers: as('STAFF') });
        expect(m.passList).toHaveBeenCalledWith(prisma, 't1', { status: 'EXHAUSTED', page: 1, limit: 20 }, true);
        expect((await app.inject({ url: '/rides/passes?status=HELD', headers: as('STAFF') })).statusCode).toBe(400);
        m.paymentList.mockResolvedValue({ data: [], pagination: {} });
        await app.inject({ url: '/rides/payments?kind=PAYG&status=REFUNDED', headers: as('STAFF') });
        expect(m.paymentList).toHaveBeenCalledWith(prisma, 't1', { kind: 'PAYG', status: 'REFUNDED', page: 1, limit: 20 }, true);
    });
});

describe('dispatch (any staff)', () => {
    it('assign returns the updated Ride (bare); errors map to 404 / 400 / 409', async () => {
        m.assignRideDriver.mockResolvedValue({ ok: true, ride, changed: true });
        const r = await app.inject({ method: 'POST', url: '/rides/r1/assign', headers: as('STAFF'), payload: { driverId: 'd1' } });
        expect(r.statusCode).toBe(200);
        expect(r.json()).toMatchObject({ id: 'r1', ref: 'TR-1', status: 'ASSIGNED', fare: null, driver: { id: 'd1', name: 'Kofi', vehicle: 'Vitz', plate: 'GR 1' } });
        expect(r.json().driver.phone).toBeUndefined();
        expect(r.json().customer.phone).not.toBe('+233241234567'); // staff are masked
        expect(prisma.auditLog.create).toHaveBeenCalled();
        m.assignRideDriver.mockResolvedValue({ ok: false, error: 'not_found' });
        expect((await app.inject({ method: 'POST', url: '/rides/r1/assign', headers: as('STAFF'), payload: { driverId: 'd1' } })).statusCode).toBe(404);
        m.assignRideDriver.mockResolvedValue({ ok: false, error: 'driver_not_found' });
        expect((await app.inject({ method: 'POST', url: '/rides/r1/assign', headers: as('STAFF'), payload: { driverId: 'd1' } })).statusCode).toBe(400);
        m.assignRideDriver.mockResolvedValue({ ok: false, error: 'invalid_state', status: 'COMPLETED' });
        expect((await app.inject({ method: 'POST', url: '/rides/r1/assign', headers: as('STAFF'), payload: { driverId: 'd1' } })).statusCode).toBe(409);
        expect((await app.inject({ method: 'POST', url: '/rides/r1/assign', headers: as('STAFF'), payload: {} })).statusCode).toBe(400);
    });

    it('status: COMPLETED returns the Ride; a second COMPLETED is 409 (nothing deducted again)', async () => {
        m.changeRideStatus.mockResolvedValue({ ok: true, ride: { ...ride, status: 'COMPLETED', completedAt: now }, changed: true, deducted: true });
        const r = await app.inject({ method: 'POST', url: '/rides/r1/status', headers: as('STAFF'), payload: { status: 'COMPLETED' } });
        expect(r.statusCode).toBe(200);
        expect(r.json()).toMatchObject({ status: 'COMPLETED' });
        expect(m.changeRideStatus).toHaveBeenCalledWith(expect.anything(), { tenantId: 't1', rideId: 'r1', status: 'COMPLETED', reason: undefined, by: 'ops' });
        m.changeRideStatus.mockResolvedValue({ ok: true, ride, changed: false, deducted: false });
        const again = await app.inject({ method: 'POST', url: '/rides/r1/status', headers: as('STAFF'), payload: { status: 'COMPLETED' } });
        expect(again.statusCode).toBe(409);
        expect(again.json().message).toBe('Ride is already COMPLETED');
        m.changeRideStatus.mockResolvedValue({ ok: false, error: 'invalid_state', status: 'CANCELLED' });
        expect((await app.inject({ method: 'POST', url: '/rides/r1/status', headers: as('STAFF'), payload: { status: 'EN_ROUTE' } })).statusCode).toBe(409);
        expect((await app.inject({ method: 'POST', url: '/rides/r1/status', headers: as('STAFF'), payload: { status: 'REQUESTED' } })).statusCode).toBe(400);
    });
});

describe('settings, drivers, destinations: reads for staff, writes for the owner only', () => {
    it('settings GET shape; PATCH is owner-only and validated', async () => {
        const g = await app.inject({ url: '/rides/settings', headers: as('STAFF') });
        expect(g.json()).toMatchObject({ package: { price: '960.00', rides: 60, days: 60, maxKm: 6, cap: 50 }, payg: { open: true, dailyLimit: 10, fares: [{ upToKm: 6, amount: '25.00' }, { upToKm: 10, amount: '35.00' }] }, roadFactor: 1.3, driverSms: false });
        expect((await app.inject({ method: 'PATCH', url: '/rides/settings', headers: as('STAFF'), payload: { payg: { open: false } } })).statusCode).toBe(403);
        m.updateRideSettings.mockResolvedValue({ ...resolveSettings(null), paygOpen: false });
        const p = await app.inject({ method: 'PATCH', url: '/rides/settings', headers: as('OWNER'), payload: { payg: { open: false } } });
        expect(p.statusCode).toBe(200);
        expect(p.json().payg.open).toBe(false);
        expect((await app.inject({ method: 'PATCH', url: '/rides/settings', headers: as('OWNER'), payload: { payg: { fares: [{ upToKm: 6, fare: '25' }] } } })).statusCode).toBe(400);
    });

    it('drivers: owner creates (phone normalised), staff cannot; PATCH deactivates; other tenants\' drivers are 404', async () => {
        expect((await app.inject({ method: 'POST', url: '/rides/drivers', headers: as('STAFF'), payload: { name: 'K', phone: '0201234567', vehicle: 'V', plate: 'P' } })).statusCode).toBe(403);
        const c = await app.inject({ method: 'POST', url: '/rides/drivers', headers: as('OWNER'), payload: { name: 'Kofi', phone: '020 123 4567', vehicle: 'Vitz', plate: 'GR 1' } });
        expect(c.statusCode).toBe(201);
        expect(c.json()).toEqual({ id: 'd1', name: 'Kofi', phone: '+233201234567', vehicle: 'Vitz', plate: 'GR 1', active: true });
        const p = await app.inject({ method: 'PATCH', url: '/rides/drivers/d1', headers: as('OWNER'), payload: { active: false } });
        expect(p.json().active).toBe(false);
        expect((await app.inject({ method: 'PATCH', url: '/rides/drivers/d1', headers: as('OWNER', 't2'), payload: { active: true } })).statusCode).toBe(404);
        expect((await app.inject({ method: 'POST', url: '/rides/drivers', headers: as('OWNER'), payload: { name: 'K', phone: 'call me', vehicle: 'V', plate: 'P' } })).statusCode).toBe(400);
        expect((await app.inject({ url: '/rides/drivers', headers: as('STAFF') })).json().data).toHaveLength(1);
    });

    it('destinations: owner-only writes with coordinate validation', async () => {
        expect((await app.inject({ method: 'POST', url: '/rides/destinations', headers: as('STAFF'), payload: { label: 'Gate', latitude: 5.6, longitude: -0.18 } })).statusCode).toBe(403);
        const c = await app.inject({ method: 'POST', url: '/rides/destinations', headers: as('OWNER'), payload: { label: 'Gate', latitude: 5.6, longitude: -0.18 } });
        expect(c.statusCode).toBe(201);
        expect(c.json()).toEqual({ id: 'x1', label: 'Gate', latitude: 5.6, longitude: -0.18, active: true, sort: 0 });
        expect((await app.inject({ method: 'POST', url: '/rides/destinations', headers: as('OWNER'), payload: { label: 'X', latitude: 95, longitude: 0 } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'PATCH', url: '/rides/destinations/zz', headers: as('OWNER'), payload: { active: false } })).statusCode).toBe(404);
    });
});

describe('cross-site console', () => {
    it('CORS lets a configured console origin send Authorization, X-Requested-With and X-CSRF-Token (with credentials)', async () => {
        const a = Fastify();
        await a.register(cors, { origin: ['https://console.turboghana.app'], credentials: true }); // as src/index.ts registers it
        a.get('/rides/overview', async () => ({}));
        const pre = await a.inject({
            method: 'OPTIONS', url: '/rides/overview',
            headers: { origin: 'https://console.turboghana.app', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,x-requested-with,x-csrf-token' },
        });
        expect(pre.statusCode).toBe(204);
        expect(pre.headers['access-control-allow-origin']).toBe('https://console.turboghana.app');
        expect(pre.headers['access-control-allow-credentials']).toBe('true');
        expect(String(pre.headers['access-control-allow-headers'])).toMatch(/x-csrf-token/);
        expect(String(pre.headers['access-control-allow-headers'])).toMatch(/x-requested-with/);
        const other = await a.inject({ method: 'OPTIONS', url: '/rides/overview', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
        expect(other.headers['access-control-allow-origin']).toBeUndefined();
        await a.close();
    });
});
