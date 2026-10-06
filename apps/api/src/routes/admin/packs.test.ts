/** Admin "Install TURBO bot": the RIDES pack installer behind a button, gated and audited. */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const install = vi.hoisted(() => vi.fn());
vi.mock('../../services/rides/install.js', () => ({ installTurboPack: install }));

import adminPackRoutes from './packs.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });
beforeEach(() => { install.mockReset(); });

async function build(tenant: Record<string, unknown> | null) {
    prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue(tenant);
    app = await buildAdminTestApp(async (s) => { await s.register(adminPackRoutes); }, { prisma });
}

const rides = { id: 't1', name: 'TURBO', vertical: 'RIDES', conversationMode: 'llm', activeFlowKey: null };

describe('GET /admin/tenants/:id/packs', () => {
    it('lists the TURBO bot as available for a RIDES organisation, not installed yet', async () => {
        await build(rides);
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const res = await app.inject({ url: '/admin/tenants/t1/packs', headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual([expect.objectContaining({ key: 'turbo-founding', vertical: 'RIDES', compatible: true, installed: false })]);
    });

    it('shows installed once the organisation runs that flow; incompatible for another type', async () => {
        await build({ ...rides, conversationMode: 'flow', activeFlowKey: 'turbo-founding' });
        let { headers } = signedInAs(app, prisma, 'READONLY');
        expect((await app.inject({ url: '/admin/tenants/t1/packs', headers })).json().data[0]).toMatchObject({ installed: true });
        await app.close();
        await build({ ...rides, vertical: 'APPOINTMENTS' });
        ({ headers } = signedInAs(app, prisma, 'READONLY'));
        expect((await app.inject({ url: '/admin/tenants/t1/packs', headers })).json().data[0]).toMatchObject({ compatible: false, installed: false });
    });

    it('404 for an unknown organisation', async () => {
        await build(null);
        const { headers } = signedInAs(app, prisma, 'READONLY');
        expect((await app.inject({ url: '/admin/tenants/nope/packs', headers })).statusCode).toBe(404);
    });
});

describe('POST /admin/tenants/:id/packs/:key/install', () => {
    const post = (headers: any, url = '/admin/tenants/t1/packs/turbo-founding/install') => app.inject({ method: 'POST', url, headers });

    it('installs, records which admin did it, and returns what changed', async () => {
        await build(rides);
        install.mockResolvedValue({ settingsCreated: true, flowVersion: 1, flowPublished: true, vertical: 'RIDES' });
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers);
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ settingsCreated: true, flowVersion: 1, flowPublished: true });
        expect(install).toHaveBeenCalledWith(expect.anything(), { tenantId: 't1', createdBy: `admin:${row.id}` });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'pack.installed', tenantId: 't1', metadata: expect.objectContaining({ pack: 'turbo-founding', flowVersion: 1 }) });
    });

    it('re-installing an up-to-date bot changes nothing and says so', async () => {
        await build({ ...rides, conversationMode: 'flow', activeFlowKey: 'turbo-founding' });
        install.mockResolvedValue({ settingsCreated: false, flowVersion: 3, flowPublished: false, vertical: 'RIDES' });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers)).json().data).toMatchObject({ flowPublished: false, upToDate: true });
    });

    it('refuses an organisation that is not RIDES (no install attempted)', async () => {
        await build({ ...rides, vertical: 'APPOINTMENTS' });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers);
        expect(res.statusCode).toBe(409);
        expect(res.json().message).toMatch(/RIDES/);
        expect(install).not.toHaveBeenCalled();
    });

    it('needs flows:write: READONLY and SUPPORT cannot install', async () => {
        await build(rides);
        for (const role of ['READONLY', 'SUPPORT']) {
            const { headers } = signedInAs(app, prisma, role);
            expect((await post(headers)).statusCode).toBe(403);
        }
        expect(install).not.toHaveBeenCalled();
    });

    it('404 for an unknown pack key', async () => {
        await build(rides);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, '/admin/tenants/t1/packs/nope/install')).statusCode).toBe(404);
    });
});
