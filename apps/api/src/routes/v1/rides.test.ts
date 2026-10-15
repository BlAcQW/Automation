import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import v1Routes from './index.js';
import { buildHarness, type Harness } from '../../test-utils/api-harness.js';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
const m = vi.hoisted(() => ({ customerBalance: vi.fn(), passBalances: vi.fn(), findOpenRide: vi.fn(), bookPackageRide: vi.fn() }));
vi.mock('../../services/rides/passes.js', async (orig) => ({ ...(await orig<object>()), customerBalance: m.customerBalance, passBalances: m.passBalances }));
vi.mock('../../services/rides/rides.js', async (orig) => ({ ...(await orig<object>()), findOpenRide: m.findOpenRide }));
vi.mock('../../services/rides/operations.js', () => ({ bookPackageRide: m.bookPackageRide }));

let h: Harness;
const CID = 'ckcust00000000000000001';
const now = new Date('2026-10-06T12:00:00Z');
const auth = (k: string) => ({ authorization: `Bearer ${k}` });
const pass = { id: 'p1', status: 'ACTIVE', ridesTotal: 60, maxKm: 6, priceMinor: 96000, creditMinor: 96000, currency: 'GHS', activatedAt: now, expiresAt: now, createdAt: now };
const bal = { purchasedMinor: 96000, usedMinor: 1600, remainingMinor: 94400, ridesTaken: 1 };
const ride = {
    id: 'r1', ref: 'TR-1', kind: 'PACKAGE', status: 'REQUESTED', pickupLabel: 'Gate', pickupLat: 5.65, pickupLng: -0.18, destinationLabel: 'Library', destinationLat: 5.66, destinationLng: -0.19,
    distanceKm: 1.1, fareMinor: 0, currency: 'GHS', source: 'APP', requestedAt: now, assignedAt: null, completedAt: null, cancelledAt: null, driver: null,
};
const body = { customerId: CID, pickup: { label: 'Gate', lat: 5.65, lng: -0.18 }, destination: { label: 'Library', lat: 5.66, lng: -0.19 } };

beforeEach(async () => {
    vi.clearAllMocks();
    h = await buildHarness(async (app) => { await app.register(v1Routes, { prefix: '/v1' }); });
    h.respond('customer.findFirst', ({ where }: any) => (where.id === CID && where.tenantId === 'tenant-a' ? { id: CID } : null));
    m.passBalances.mockResolvedValue(new Map([['p1', bal]]));
});
afterEach(async () => { await h.close(); });

describe('scopes', () => {
    it('reads need rides:read, booking needs rides:write', async () => {
        const noScope = h.makeKey({ scopes: ['customers:read'] });
        expect((await h.app.inject({ url: `/v1/rides/customers/${CID}/balance`, headers: auth(noScope) })).statusCode).toBe(403);
        const readOnly = h.makeKey({ scopes: ['rides:read'] });
        expect((await h.app.inject({ method: 'POST', url: '/v1/rides', headers: auth(readOnly), payload: body })).statusCode).toBe(403);
    });
});

describe('GET /v1/rides/customers/:id/balance', () => {
    it('returns the current package and balance, tenant-scoped', async () => {
        m.customerBalance.mockResolvedValue({ pass, active: true, ...bal, availableMinor: 92800, expiresAt: now });
        const k = h.makeKey({ scopes: ['rides:read'] });
        const r = await h.app.inject({ url: `/v1/rides/customers/${CID}/balance`, headers: auth(k) });
        expect(r.statusCode).toBe(200);
        expect(r.json().data).toMatchObject({
            customerId: CID, active: true, currency: 'GHS', credit: '960.00', used: '16.00', remaining: '944.00', available: '928.00', ridesTaken: 1,
            package: { id: 'p1', status: 'ACTIVE', price: '960.00', credit: '960.00', used: '16.00', remaining: '944.00', ridesTaken: 1 },
        });
        expect(r.json().data.package.ridesRemaining).toBeUndefined();
        expect(m.customerBalance).toHaveBeenCalledWith(expect.anything(), 'tenant-a', CID);
        expect(h.violations).toEqual([]);
    });
    it('another tenant\'s customer is 404', async () => {
        const k = h.makeKey({ scopes: ['rides:read'], tenantId: 'tenant-b' });
        const r = await h.app.inject({ url: `/v1/rides/customers/${CID}/balance`, headers: auth(k) });
        expect(r.statusCode).toBe(404);
        expect(r.json().error.code).toBe('not_found');
    });
});

describe('GET passes and rides', () => {
    it('lists with cursor pagination and tenant filters', async () => {
        h.respond('ridePass.findMany', [pass]);
        h.respond('ride.findMany', [ride]);
        const k = h.makeKey({ scopes: ['rides:read'] });
        const p = await h.app.inject({ url: `/v1/rides/customers/${CID}/passes`, headers: auth(k) });
        expect(p.json()).toMatchObject({ data: [{ id: 'p1', used: '16.00', remaining: '944.00', ridesTaken: 1 }], pagination: { hasMore: false } });
        expect(h.find('ridePass', 'findMany')[0].args.where).toEqual({ tenantId: 'tenant-a', customerId: CID, status: { not: 'HELD' } });
        const r = await h.app.inject({ url: `/v1/rides/customers/${CID}/rides?limit=5`, headers: auth(k) });
        expect(r.json().data[0]).toMatchObject({ id: 'r1', ref: 'TR-1', fare: null, source: 'APP', pickup: { label: 'Gate' } });
        expect(h.find('ride', 'findMany')[0].args).toMatchObject({
            where: { tenantId: 'tenant-a', customerId: CID, NOT: [{ kind: 'PAYG', paidAt: null }, { kind: 'PACKAGE', paidAt: null, topupMinor: { gt: 0 } }] }, take: 6,
        });
    });
});

describe('POST /v1/rides', () => {
    const post = (payload: unknown) => h.app.inject({ method: 'POST', url: '/v1/rides', headers: auth(h.makeKey({ scopes: ['rides:write'] })), payload: payload as any });

    it('books a package ride from the app (201)', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: true, ride: { ...ride, fareMinor: 1600, priceBasis: 'PICKUP', balanceAppliedMinor: 1600 }, settlement: { mode: 'balance' } });
        const r = await post(body);
        expect(r.statusCode).toBe(201);
        expect(r.json().data).toMatchObject({ id: 'r1', status: 'REQUESTED', fare: '16.00', balanceApplied: '16.00', priceBasis: 'PICKUP' });
        expect(m.bookPackageRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 'tenant-a', customerId: CID, source: 'APP' }));
    });

    it('maps refusals to error codes; a retry of the same trip returns the same ride', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'no_balance' });
        expect((await post(body)).json().error.code).toBe('no_balance');
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'needs_topup' });
        const topup = await post(body);
        expect([topup.statusCode, topup.json().error.code]).toEqual([409, 'needs_topup']);
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'not_offered' });
        expect((await post(body)).statusCode).toBe(422);
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'open_ride' });
        m.findOpenRide.mockResolvedValue(ride);
        const replay = await post(body);
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data.id).toBe('r1');
        m.findOpenRide.mockResolvedValue({ ...ride, source: 'WHATSAPP' });
        expect((await post(body)).statusCode).toBe(409);
    });

    it('validates the body: exactly one of destination / destinationId, real coordinates', async () => {
        expect((await post({ customerId: CID, pickup: body.pickup })).statusCode).toBe(400);
        expect((await post({ ...body, destinationId: 'd1' })).statusCode).toBe(400);
        expect((await post({ ...body, pickup: { label: 'x', lat: 91, lng: 0 } })).statusCode).toBe(400);
        h.respond('rideDestination.findFirst', null);
        expect((await post({ customerId: CID, pickup: body.pickup, destinationId: 'd404' })).statusCode).toBe(404);
    });
});
