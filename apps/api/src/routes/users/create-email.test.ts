/**
 * POST /users (owner adds staff): one email, one account ACROSS tenants.
 * Login resolves a user by email alone, so an owner must not be able to create
 * a staff login with an address that already belongs to someone elsewhere.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { getTenantContext, tenantContextOnRequest, bindTenantContext } from '../../lib/tenant-context.js';

vi.mock('../../services/audit.js', () => ({ audit: vi.fn(async () => undefined) }));

import usersRoutes from './index.js';

async function build(takenEmails: string[]) {
    const seen: Array<{ ctxTenant: string | undefined; where: any }> = [];
    const tx: any = {
        $executeRaw: vi.fn(async () => 1),
        user: {
            findFirst: vi.fn(async ({ where }: any) => {
                seen.push({ ctxTenant: getTenantContext()?.tenantId, where });
                const wanted = String(where.email?.equals ?? where.email).toLowerCase();
                return takenEmails.includes(wanted) ? { id: 'other' } : null;
            }),
            create: vi.fn(async ({ data }: any) => ({ id: 'u2', email: data.email, name: data.name, role: 'STAFF', isActive: true })),
        },
    };
    const prisma: any = { ...tx, $transaction: async (fn: any) => fn(tx) };
    const app = Fastify();
    app.addHook('onRequest', tenantContextOnRequest);
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId: 'owner', tenantId: 't1', role: 'OWNER' };
        bindTenantContext({ tenantId: 't1', userId: 'owner' });
    });
    await app.register(usersRoutes, { prefix: '/users' });
    return { app, tx, seen };
}

const create = (app: any, email: string) =>
    app.inject({ method: 'POST', url: '/users', payload: { email, password: 'longenough1', name: 'Kofi' } });

describe('POST /users email claim', () => {
    it('refuses an email already used by an account in ANOTHER tenant (case-insensitive)', async () => {
        const { app, tx } = await build(['victim@example.com']);
        const res = await create(app, 'Victim@Example.com');
        expect(res.statusCode).toBe(409);
        expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('takes the advisory lock and checks globally, outside the tenant scope', async () => {
        const { app, tx, seen } = await build([]);
        const res = await create(app, 'new@example.com');
        expect(res.statusCode).toBe(200);
        expect(tx.$executeRaw).toHaveBeenCalled();
        const lookup = seen.at(-1)!;
        expect(lookup.where.tenantId).toBeUndefined();
        // The deliberate global lookup runs with no tenant in context, so the guard allows it.
        expect(lookup.ctxTenant).toBeUndefined();
        expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 't1', role: 'STAFF' }) }));
    });
});
