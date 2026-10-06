import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import auditLogRoutes, { auditQuerySchema, buildAuditWhere, MAX_RANGE_DAYS } from './audit-log.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

const NOW = new Date('2026-10-06T12:00:00Z');
const day = 86_400_000;

describe('auditQuerySchema + buildAuditWhere', () => {
    it('defaults to the last 7 days, page size 50', () => {
        const q = auditQuerySchema.parse({});
        expect(q.limit).toBe(50);
        const w = buildAuditWhere(q, NOW);
        expect(w.createdAt.gte).toEqual(new Date(NOW.getTime() - 7 * day));
        expect(w.createdAt.lte).toEqual(NOW);
    });

    it('applies tenant, actor, action and date filters', () => {
        const q = auditQuerySchema.parse({
            tenantId: 't1', actorId: 'admin-1', actorType: 'ADMIN', action: 'tenant.updated',
            from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z',
        });
        expect(buildAuditWhere(q, NOW)).toEqual({
            tenantId: 't1', actorId: 'admin-1', actorType: 'ADMIN', action: 'tenant.updated',
            createdAt: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-03T00:00:00Z') },
        });
    });

    it('an action prefix matches a family (support.*)', () => {
        const q = auditQuerySchema.parse({ actionPrefix: 'support.' });
        expect(buildAuditWhere(q, NOW).action).toEqual({ startsWith: 'support.' });
    });

    it('action and actionPrefix together is refused (ambiguous)', () => {
        expect(auditQuerySchema.safeParse({ action: 'a', actionPrefix: 'b' }).success).toBe(false);
    });

    it('refuses a window wider than the maximum, or reversed', () => {
        expect(MAX_RANGE_DAYS).toBeLessThanOrEqual(90);
        expect(auditQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }).success).toBe(false);
        expect(auditQuerySchema.safeParse({ from: '2026-10-03T00:00:00Z', to: '2026-10-01T00:00:00Z' }).success).toBe(false);
    });

    it('an open-ended "from" is bounded by now', () => {
        const q = auditQuerySchema.parse({ from: new Date(NOW.getTime() - 3 * day).toISOString() });
        expect(buildAuditWhere(q, NOW).createdAt.lte).toEqual(NOW);
    });

    it('rejects bad enums, oversize limit, non-dates', () => {
        expect(auditQuerySchema.safeParse({ actorType: 'ROBOT' }).success).toBe(false);
        expect(auditQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
        expect(auditQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    });
});

describe('GET /admin/audit', () => {
    async function build() {
        prisma = makePrisma();
        app = await buildAdminTestApp(async (s) => { await s.register(auditLogRoutes); }, { prisma });
    }
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
        id: `l${i}`, tenantId: 't1', actorType: 'ADMIN', actorId: 'admin-1', action: 'tenant.updated', targetType: 'Tenant', targetId: 't1',
        metadata: { x: 1 }, ipAddress: '1.2.3.4', createdAt: new Date(NOW.getTime() - i * 1000),
    }));

    it('returns a page, resolves actor and tenant names, and a cursor when there is more', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        prisma.auditLog.findMany.mockResolvedValue(rows(3)); // limit 2 -> fetched 3
        prisma.admin.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Ada', email: 'a@x.com' }]);
        prisma.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'Swift Rides' }]);
        const res = await app.inject({ method: 'GET', url: '/admin/audit?limit=2', headers });
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j.data).toHaveLength(2);
        expect(j.nextCursor).toBe('l1');
        expect(j.data[0]).toMatchObject({ id: 'l0', actorName: 'Ada', tenantName: 'Swift Rides', action: 'tenant.updated' });
        const args = prisma.auditLog.findMany.mock.calls[0][0];
        expect(args.take).toBe(3);
        expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('no cursor on the last page; cursor request skips the cursor row', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.auditLog.findMany.mockResolvedValue(rows(1));
        const res = await app.inject({ method: 'GET', url: '/admin/audit?limit=5&cursor=l9', headers });
        expect(res.json().nextCursor).toBeNull();
        const args = prisma.auditLog.findMany.mock.calls[0][0];
        expect(args.cursor).toEqual({ id: 'l9' });
        expect(args.skip).toBe(1);
    });

    it('passes the filters through to the query', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        await app.inject({ method: 'GET', url: '/admin/audit?tenantId=t1&actorId=admin-1&actionPrefix=support.', headers });
        const where = prisma.auditLog.findMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ tenantId: 't1', actorId: 'admin-1', action: { startsWith: 'support.' } });
    });

    it('every role can read it (transparency); 400 on a too-wide window; 401 without a token', async () => {
        await build();
        for (const role of ['OWNER', 'FINANCE', 'SUPPORT', 'READONLY']) {
            const { headers } = signedInAs(app, prisma, role);
            expect((await app.inject({ method: 'GET', url: '/admin/audit', headers })).statusCode).toBe(200);
        }
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await app.inject({ method: 'GET', url: '/admin/audit?from=2020-01-01T00:00:00Z', headers })).statusCode).toBe(400);
        expect((await app.inject({ method: 'GET', url: '/admin/audit' })).statusCode).toBe(401);
    });
});
