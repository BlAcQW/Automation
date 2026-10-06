import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../services/notifications.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));

import adminApiKeyRoutes from './api-keys.js';
import { createNotification } from '../../services/notifications.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const T0 = new Date('2026-10-01T00:00:00Z');
const keyRow = (over: Record<string, unknown> = {}) => ({
    id: 'k1', name: 'TURBO prod', prefix: 'abcdefghij', scopes: ['messages:write'], createdAt: T0, createdBy: 'u1',
    lastUsedAt: T0, expiresAt: null, revokedAt: null, rotatedFromId: null, ...over,
});

async function build() {
    prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', name: 'Swift Rides' });
    prisma.apiKey.findMany.mockResolvedValue([keyRow(), keyRow({ id: 'k0', prefix: 'zzzzzzzzzz', revokedAt: T0, createdBy: null })]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Kofi', email: 'kofi@x.com' }]);
    prisma.apiKey.updateMany.mockResolvedValue({ count: 1 });
    app = await buildAdminTestApp(async (s) => { await s.register(adminApiKeyRoutes); }, { prisma });
}

const list = (headers: any, id = 't1') => app.inject({ method: 'GET', url: `/admin/organisations/${id}/api-keys`, headers });
const revoke = (headers: any, payload: unknown = { reason: 'leaked in a public repo' }, keyId = 'k1') =>
    app.inject({ method: 'POST', url: `/admin/organisations/t1/api-keys/${keyId}/revoke`, headers, payload: payload as any });
const revokeAll = (headers: any, payload: unknown = { reason: 'organisation compromised' }) =>
    app.inject({ method: 'POST', url: '/admin/organisations/t1/api-keys/revoke-all', headers, payload: payload as any });

describe('GET /admin/organisations/:id/api-keys', () => {
    it('lists the organisation\'s keys with who made them and their status, never the hash', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const res = await list(headers);
        expect(res.statusCode).toBe(200);
        const { data } = res.json();
        expect(data).toHaveLength(2);
        expect(data[0]).toMatchObject({
            id: 'k1', name: 'TURBO prod', prefix: 'abcdefghij', scopes: ['messages:write'], status: 'active',
            createdBy: { id: 'u1', name: 'Kofi' }, lastUsedAt: T0.toISOString(), expiresAt: null, revokedAt: null,
        });
        expect(data[1]).toMatchObject({ status: 'revoked', createdBy: null });
        const args = prisma.apiKey.findMany.mock.calls[0][0];
        expect(args.where).toEqual({ tenantId: 't1' });
        expect(args.select.secretHash).toBeUndefined();
        expect(args.take).toBeLessThanOrEqual(200);
        expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', id: { in: ['u1'] } });
        expect(res.body).not.toMatch(/secretHash|bk_live_/);
    });

    it('every admin role that can read organisations can read keys', async () => {
        await build();
        for (const role of ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY']) {
            const { headers } = signedInAs(app, prisma, role);
            expect((await list(headers)).statusCode, role).toBe(200);
        }
    });

    it('404 for an unknown organisation; 401 without a token', async () => {
        await build();
        prisma.tenant.findUnique.mockResolvedValue(null);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await list(headers, 'nope')).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: '/admin/organisations/t1/api-keys' })).statusCode).toBe(401);
    });
});

describe('POST /admin/organisations/:id/api-keys/:keyId/revoke', () => {
    it('OWNER revokes one key, audited with the admin and reason, and the owner is notified', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        const res = await revoke(headers);
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({ id: 'k1', revoked: true });
        const upd = prisma.apiKey.updateMany.mock.calls[0][0];
        expect(upd.where).toEqual({ id: 'k1', tenantId: 't1', revokedAt: null });
        expect(prisma.audits).toHaveLength(1);
        expect(prisma.audits[0]).toMatchObject({
            action: 'api_key.admin_revoked', actorType: 'ADMIN', actorId: row.id, tenantId: 't1', targetType: 'API_KEY', targetId: 'k1',
            metadata: expect.objectContaining({ reason: 'leaked in a public repo' }),
        });
        expect(createNotification).toHaveBeenCalledTimes(1);
        const [client, note] = (createNotification as any).mock.calls[0];
        expect(client).toBe(prisma);
        expect(note).toMatchObject({ tenantId: 't1', type: 'SYSTEM' });
        expect(note.message).toContain('leaked in a public repo');
    });

    it('SUPPORT may revoke', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        expect((await revoke(headers)).statusCode).toBe(200);
    });

    it.each(['FINANCE', 'READONLY'])('%s may not revoke (403, nothing changes)', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        expect((await revoke(headers)).statusCode).toBe(403);
        expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
        expect(prisma.audits).toHaveLength(0);
    });

    it.each([
        ['missing reason', {}],
        ['blank reason', { reason: '  ' }],
        ['too long', { reason: 'x'.repeat(301) }],
        ['extra field', { reason: 'fine reason', tenantId: 'other' }],
    ])('400 for %s', async (_n, payload) => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await revoke(headers, payload)).statusCode).toBe(400);
        expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
    });

    it('404 when the key is not this organisation\'s', async () => {
        await build();
        prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });
        prisma.apiKey.findFirst.mockResolvedValue(null);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await revoke(headers)).statusCode).toBe(404);
        expect(prisma.audits).toHaveLength(0);
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('already revoked: 200 no-op, no audit, no notification', async () => {
        await build();
        prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });
        prisma.apiKey.findFirst.mockResolvedValue({ id: 'k1' });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await revoke(headers);
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({ id: 'k1', revoked: false });
        expect(prisma.audits).toHaveLength(0);
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('a failing notification does not undo or fail the revoke', async () => {
        await build();
        (createNotification as any).mockRejectedValueOnce(new Error('push down'));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await revoke(headers)).statusCode).toBe(200);
        expect(prisma.audits).toHaveLength(1);
    });
});

describe('POST /admin/organisations/:id/api-keys/revoke-all', () => {
    it('revokes every working key, audits the count and reason, notifies the owner', async () => {
        await build();
        prisma.apiKey.updateMany.mockResolvedValue({ count: 3 });
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        const res = await revokeAll(headers);
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({ revoked: 3 });
        const where = prisma.apiKey.updateMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ tenantId: 't1', revokedAt: null }); // keys whose grace already ran out are left alone
        expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
        expect(prisma.audits[0]).toMatchObject({
            action: 'api_key.admin_revoked_all', actorType: 'ADMIN', actorId: row.id, tenantId: 't1',
            metadata: { reason: 'organisation compromised', count: 3 },
        });
        expect(createNotification).toHaveBeenCalledTimes(1);
    });

    it('nothing to revoke: 200 with 0, audited, no notification', async () => {
        await build();
        prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await revokeAll(headers);
        expect(res.json().data).toEqual({ revoked: 0 });
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('reason is required; 404 for an unknown organisation; FINANCE refused', async () => {
        await build();
        const owner = signedInAs(app, prisma, 'OWNER').headers;
        expect((await revokeAll(owner, {})).statusCode).toBe(400);
        prisma.tenant.findUnique.mockResolvedValue(null);
        expect((await revokeAll(owner)).statusCode).toBe(404);
        expect((await revokeAll(signedInAs(app, prisma, 'FINANCE').headers)).statusCode).toBe(403);
        expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
    });
});
