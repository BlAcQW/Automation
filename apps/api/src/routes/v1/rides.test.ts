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
const pass = { id: 'p1', status: 'ACTIVE', ridesTotal: 60, maxKm: 6, priceMinor: 96000, currency: 'GHS', activatedAt: now, expiresAt: now, createdAt: now };
const ride = {
    id: 'r1', ref: 'TR-1', kind: 'PACKAGE', status: 'REQUESTED', pickupLabel: 'Gate', pickupLat: 5.65, pickupLng: -0.18, destinationLabel: 'Library', destinationLat: 5.66, destinationLng: -0.19,
    distanceKm: 1.1, fareMinor: 0, currency: 'GHS', source: 'APP', requestedAt: now, assignedAt: null, completedAt: null, cancelledAt: null, driver: null,
};
const body = { customerId: CID, pickup: { label: 'Gate', lat: 5.65, lng: -0.18 }, destination: { label: 'Library', lat: 5.66, lng: -0.19 } };

beforeEach(async () => {
    vi.clearAllMocks();
    h = await buildHarness(async (app) => { await app.register(v1Routes, { prefix: '/v1' }); });
    h.respond('customer.findFirst', ({ where }: any) => (where.id === CID && where.tenantId === 'tenant-a' ? { id: CID } : null));
    m.passBalances.mockResolvedValue(new Map([['p1', { purchased: 60, used: 1, remaining: 59 }]]));
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
        m.customerBalance.mockResolvedValue({ pass, active: true, purchased: 60, used: 1, remaining: 59, expiresAt: now });
        const k = h.makeKey({ scopes: ['rides:read'] });
        const r = await h.app.inject({ url: `/v1/rides/customers/${CID}/balance`, headers: auth(k) });
        expect(r.statusCode).toBe(200);
        expect(r.json().data).toMatchObject({ customerId: CID, active: true, purchased: 60, used: 1, remaining: 59, package: { id: 'p1', status: 'ACTIVE', ridesRemaining: 59, price: '960.00' } });
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
        expect(p.json()).toMatchObject({ data: [{ id: 'p1', ridesUsed: 1, ridesRemaining: 59 }], pagination: { hasMore: false } });
        expect(h.find('ridePass', 'findMany')[0].args.where).toEqual({ tenantId: 'tenant-a', customerId: CID, status: { not: 'HELD' } });
        const r = await h.app.inject({ url: `/v1/rides/customers/${CID}/rides?limit=5`, headers: auth(k) });
        expect(r.json().data[0]).toMatchObject({ id: 'r1', ref: 'TR-1', fare: null, source: 'APP', pickup: { label: 'Gate' } });
        expect(h.find('ride', 'findMany')[0].args).toMatchObject({ where: { tenantId: 'tenant-a', customerId: CID, NOT: { kind: 'PAYG', paidAt: null } }, take: 6 });
    });
});

describe('POST /v1/rides', () => {
    const post = (payload: unknown) => h.app.inject({ method: 'POST', url: '/v1/rides', headers: auth(h.makeKey({ scopes: ['rides:write'] })), payload: payload as any });

    it('books a package ride from the app (201)', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: true, ride, remaining: 59 });
        const r = await post(body);
        expect(r.statusCode).toBe(201);
        expect(r.json().data).toMatchObject({ id: 'r1', status: 'REQUESTED' });
        expect(m.bookPackageRide).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 'tenant-a', customerId: CID, source: 'APP' }));
    });

    it('maps refusals to error codes; a retry of the same trip returns the same ride', async () => {
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'no_rides_left' });
        expect((await post(body)).json().error.code).toBe('no_rides_left');
        m.bookPackageRide.mockResolvedValue({ ok: false, reason: 'too_far' });
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
