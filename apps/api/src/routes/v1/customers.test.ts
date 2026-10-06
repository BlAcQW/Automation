import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import v1Routes from './index.js';
import { buildHarness, type Harness } from '../../test-utils/api-harness.js';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn().mockResolvedValue({ eventId: 'e1' }) }));

import { publishEvent } from '../../services/events/publish.js';

let h: Harness;
beforeEach(async () => {
    vi.clearAllMocks();
    h = await buildHarness(async (app) => { await app.register(v1Routes, { prefix: '/v1' }); });
});
afterEach(async () => { await h.close(); });

const auth = (k: string) => ({ authorization: `Bearer ${k}` });
const CID = 'ckcust00000000000000001';
const cust = (over: Record<string, unknown> = {}) => ({
    id: CID, tenantId: 'tenant-a', phone: '+233241234567', name: 'Ama', email: null, attributes: { studentId: 'S1' },
    createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe('POST /v1/customers', () => {
    const scopes = ['customers:write' as const];
    const post = (k: string, payload: unknown) => h.app.inject({ method: 'POST', url: '/v1/customers', headers: auth(k), payload: payload as any });

    it('creates a tenant-owned customer and returns 201 { data }', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-b' });
        const res = await post(k, { phone: '+233241234567', name: 'Ama', email: 'ama@example.com', attributes: { studentId: 'S1' } });
        expect(res.statusCode).toBe(201);
        expect(h.find('customer', 'findFirst')[0].args.where).toEqual({ tenantId: 'tenant-b', phone: '+233241234567' });
        expect(h.find('customer', 'create')[0].args.data).toMatchObject({
            tenantId: 'tenant-b', phone: '+233241234567', name: 'Ama', email: 'ama@example.com', attributes: { studentId: 'S1' },
        });
        const body = res.json().data;
        expect(body).toMatchObject({ phone: '+233241234567', name: 'Ama' });
        expect(body).not.toHaveProperty('tenantId');
        expect(publishEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            tenantId: 'tenant-b', type: 'customer.created',
        }));
        expect(h.violations).toEqual([]);
    });

    it('409 when the phone already exists in this tenant, without creating', async () => {
        h.respond('customer.findFirst', cust());
        const k = h.makeKey({ scopes });
        const res = await post(k, { phone: '+233241234567' });
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe('conflict');
        expect(h.find('customer', 'create')).toHaveLength(0);
    });

    it('409 when a concurrent create wins the unique constraint', async () => {
        h.respond('customer.create', () => { throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }); });
        const k = h.makeKey({ scopes });
        const res = await post(k, { phone: '+233241234567' });
        expect(res.statusCode).toBe(409);
    });

    it.each([
        ['local format', { phone: '0241234567' }],
        ['no plus', { phone: '233241234567' }],
        ['spaces', { phone: '+233 24 123 4567' }],
        ['too short', { phone: '+1234' }],
        ['too long', { phone: '+1234567890123456' }],
        ['leading zero country code', { phone: '+0233241234567' }],
        ['letters', { phone: '+23324abc4567' }],
        ['missing phone', { name: 'x' }],
        ['bad email', { phone: '+233241234567', email: 'nope' }],
        ['name too long', { phone: '+233241234567', name: 'x'.repeat(121) }],
        ['attributes array', { phone: '+233241234567', attributes: [1] }],
        ['attributes string', { phone: '+233241234567', attributes: 'x' }],
        ['unknown field', { phone: '+233241234567', tenantId: 'tenant-evil' }],
    ])('400 for %s', async (_n, payload) => {
        const k = h.makeKey({ scopes });
        const res = await post(k, payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('validation_error');
        expect(h.find('customer', 'create')).toHaveLength(0);
    });

    it('caps attributes at 4096 bytes of JSON', async () => {
        const k = h.makeKey({ scopes });
        const overhead = JSON.stringify({ a: '' }).length;
        const ok = await post(k, { phone: '+233241234567', attributes: { a: 'x'.repeat(4096 - overhead) } });
        expect(ok.statusCode).toBe(201);
        const big = await post(k, { phone: '+233241234568', attributes: { a: 'x'.repeat(4096 - overhead + 1) } });
        expect(big.statusCode).toBe(400);
        // multi-byte characters count as bytes, not code units
        const wide = await post(k, { phone: '+233241234569', attributes: { a: '中'.repeat(1400) } });
        expect(wide.statusCode).toBe(400);
    });

    it('403 without customers:write', async () => {
        const k = h.makeKey({ scopes: ['customers:read'] });
        expect((await post(k, { phone: '+233241234567' })).statusCode).toBe(403);
    });
});

describe('GET /v1/customers', () => {
    const scopes = ['customers:read' as const];

    it('lists tenant customers with cursor pagination', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-b' });
        h.respond('customer.findMany', [cust({ id: 'ckcust0000000000000000a' }), cust({ id: 'ckcust0000000000000000b' })]);
        const res = await h.app.inject({ method: 'GET', url: '/v1/customers?limit=1', headers: auth(k) });
        const q = h.find('customer', 'findMany')[0].args;
        expect(q.where).toEqual({ tenantId: 'tenant-b' });
        expect(q.take).toBe(2);
        expect(res.json().data).toHaveLength(1);
        expect(res.json().pagination.hasMore).toBe(true);
    });

    it('filters by exact E.164 phone', async () => {
        const k = h.makeKey({ scopes });
        await h.app.inject({ method: 'GET', url: `/v1/customers?phone=${encodeURIComponent('+233241234567')}`, headers: auth(k) });
        expect(h.find('customer', 'findMany')[0].args.where).toEqual({ tenantId: 'tenant-a', phone: '+233241234567' });
    });

    it('400 for a non-E.164 phone filter', async () => {
        const k = h.makeKey({ scopes });
        expect((await h.app.inject({ method: 'GET', url: '/v1/customers?phone=0241234567', headers: auth(k) })).statusCode).toBe(400);
    });

    it('GET /:id is tenant scoped; foreign ids 404', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-b' });
        const res = await h.app.inject({ method: 'GET', url: `/v1/customers/${CID}`, headers: auth(k) });
        expect(res.statusCode).toBe(404);
        expect(h.find('customer', 'findFirst')[0].args.where).toEqual({ id: CID, tenantId: 'tenant-b' });
    });

    it('GET /:id returns the customer', async () => {
        h.respond('customer.findFirst', cust());
        const k = h.makeKey({ scopes });
        const res = await h.app.inject({ method: 'GET', url: `/v1/customers/${CID}`, headers: auth(k) });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.id).toBe(CID);
    });

    it('403 without customers:read', async () => {
        const k = h.makeKey({ scopes: ['customers:write'] });
        expect((await h.app.inject({ method: 'GET', url: '/v1/customers', headers: auth(k) })).statusCode).toBe(403);
    });
});

describe('PATCH /v1/customers/:id', () => {
    const scopes = ['customers:write' as const];
    const patch = (k: string, payload: unknown) => h.app.inject({ method: 'PATCH', url: `/v1/customers/${CID}`, headers: auth(k), payload: payload as any });

    it('updates with a tenant-scoped updateMany and returns the fresh row', async () => {
        h.respond('customer.findFirst', cust({ name: 'New' }));
        const k = h.makeKey({ scopes, tenantId: 'tenant-a' });
        const res = await patch(k, { name: 'New', email: 'n@example.com' });
        expect(res.statusCode).toBe(200);
        const upd = h.find('customer', 'updateMany')[0].args;
        expect(upd.where).toEqual({ id: CID, tenantId: 'tenant-a' });
        expect(upd.data).toEqual({ name: 'New', email: 'n@example.com' });
        expect(h.find('customer', 'update')).toHaveLength(0);
        expect(res.json().data.name).toBe('New');
        expect(publishEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            type: 'customer.updated', payload: expect.objectContaining({ customerId: CID, changed: ['name', 'email'] }),
        }));
    });

    it('replaces attributes, and null clears them', async () => {
        h.respond('customer.findFirst', cust());
        const k = h.makeKey({ scopes });
        await patch(k, { attributes: { university: 'KNUST' } });
        expect(h.find('customer', 'updateMany')[0].args.data).toEqual({ attributes: { university: 'KNUST' } });
        await patch(k, { attributes: null });
        expect(h.find('customer', 'updateMany')[1].args.data).toEqual({ attributes: Prisma.JsonNull });
    });

    it('404 when no row matches this tenant', async () => {
        h.respond('customer.updateMany', { count: 0 });
        const k = h.makeKey({ scopes, tenantId: 'tenant-b' });
        const res = await patch(k, { name: 'x' });
        expect(res.statusCode).toBe(404);
        expect(publishEvent).not.toHaveBeenCalled();
    });

    it.each([
        ['phone is immutable', { phone: '+233241234568' }],
        ['empty body', {}],
        ['bad email', { email: 'x' }],
        ['oversized attributes', { attributes: { a: 'x'.repeat(5000) } }],
        ['tenantId', { tenantId: 'tenant-evil' }],
    ])('400 for %s', async (_n, payload) => {
        const k = h.makeKey({ scopes });
        const res = await patch(k, payload);
        expect(res.statusCode).toBe(400);
        expect(h.find('customer', 'updateMany')).toHaveLength(0);
    });
});
