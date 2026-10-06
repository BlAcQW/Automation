import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import flowRoutes from './flows.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
let rows: any[];
afterEach(async () => { await app?.close(); });

const flow = (prompt = 'Welcome! Reply 1 for rides', price?: number) => ({
    key: 'ignored', version: 99, start: 'menu',
    states: {
        menu: { type: 'menu', prompt, options: [{ label: 'Rides', next: price === undefined ? 'bye' : 'pay' }] },
        ...(price === undefined ? {} : {
            pay: { type: 'payment', kind: 'test_kind', amount: price, prompt: `Pay GHS ${price} here: {payment_url}`, onSuccess: 'bye' },
        }),
        bye: { type: 'end', text: 'Thanks' },
    },
});

function wireFlowTable(p: PrismaStub) {
    let seq = 0;
    const matches = (r: any, where: any) =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (v && typeof v === 'object' && 'gt' in (v as any)) return r[k] > (v as any).gt;
            return r[k] === v;
        });
    p.flowDefinition.findMany.mockImplementation(async ({ where, orderBy, take }: any) => {
        let out = rows.filter((r) => matches(r, where));
        out = [...out].sort((a, b) => (a.key === b.key ? a.version - b.version : a.key.localeCompare(b.key)));
        return take ? out.slice(0, take) : out;
    });
    p.flowDefinition.create.mockImplementation(async ({ data }: any) => {
        const row = { id: `fd${++seq}`, createdAt: new Date('2026-10-06T10:00:00Z'), ...data };
        rows.push(row);
        return row;
    });
    p.flowDefinition.updateMany.mockImplementation(async ({ where, data }: any) => {
        let n = 0;
        for (const r of rows) {
            if (r.tenantId === where.tenantId && r.key === where.key && matches({ version: r.version }, { version: where.version })) { Object.assign(r, data); n++; }
        }
        return { count: n };
    });
    p.flowDefinition.delete.mockImplementation(async ({ where }: any) => { rows = rows.filter((r) => r.id !== where.id); return {}; });
    p.tenant.findUnique.mockResolvedValue({ id: 't1' });
}

beforeEach(async () => {
    rows = [];
    const { registerPaymentFulfiller, isRegisteredFulfillmentKind } = await import('../../services/payment-fulfillers.js');
    if (!isRegisteredFulfillmentKind('test_kind')) registerPaymentFulfiller('test_kind', async () => ({ status: 'applied' }));
});

async function build() {
    prisma = makePrisma();
    wireFlowTable(prisma);
    app = await buildAdminTestApp(async (s) => { await s.register(flowRoutes); }, { prisma });
}
const call = (method: string, url: string, headers: any, payload?: unknown) =>
    app.inject({ method: method as any, url, headers, payload: payload as any });

describe('POST /admin/flows/validate', () => {
    it('ok:true for a valid flow; no write', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await call('POST', '/admin/flows/validate', headers, { definition: flow() });
        expect(res.json()).toEqual({ ok: true, errors: [] });
        expect(prisma.flowDefinition.create).not.toHaveBeenCalled();
    });
    it('returns every validation error, readable', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const bad = { start: 'nope', states: { menu: { type: 'menu', prompt: 'Hi {mystery}', options: [{ label: 'A', next: 'ghost' }] } } };
        const res = await call('POST', '/admin/flows/validate', headers, { definition: bad });
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j.ok).toBe(false);
        expect(j.errors.join('\n')).toMatch(/unknown state "ghost"|start state "nope"/);
    });
    it('a non-object is a 400; an oversized definition is refused', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await call('POST', '/admin/flows/validate', headers, { definition: 'x' })).statusCode).toBe(400);
        const huge = { definition: { start: 'a', states: {}, pad: 'x'.repeat(300_000) } };
        expect((await call('POST', '/admin/flows/validate', headers, huge)).statusCode).toBeGreaterThanOrEqual(400);
    });
    it('SUPPORT may validate (read-only) but not save', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        expect((await call('POST', '/admin/flows/validate', headers, { definition: flow() })).statusCode).toBe(200);
        expect((await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow() })).statusCode).toBe(403);
    });
});

describe('saving versions (never in place)', () => {
    it('saves a NEW version as an inactive draft with the assigned key/version; audited', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        const res = await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow('Welcome!') });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ key: 'main', version: 1, isActive: false, tenantId: 't1' });
        expect(rows[0].definition).toMatchObject({ key: 'main', version: 1 });
        expect(rows[0].createdBy).toBe(row.id);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'flow.version.created', actorId: row.id, tenantId: 't1', metadata: expect.objectContaining({ key: 'main', version: 1, activated: false }) });
    });

    it('editing a price creates version 2 and leaves version 1 untouched', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow('Hi', 100), activate: true });
        const v1 = JSON.parse(JSON.stringify(rows[0].definition));
        const res = await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow('Hi', 120) });
        expect(res.json().version).toBe(2);
        expect(rows).toHaveLength(2);
        expect(rows[0].definition).toEqual(v1);
        expect(rows[1].definition.states.pay.amount).toBe(120);
        // the draft did not displace the active one
        expect(rows[0].isActive).toBe(true);
        expect(rows[1].isActive).toBe(false);
    });

    it('invalid definitions are 422 with the error list, and nothing is written', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: { start: 'x', states: {} } });
        expect(res.statusCode).toBe(422);
        expect(res.json().errors.length).toBeGreaterThan(0);
        expect(rows).toHaveLength(0);
        expect(prisma.audits).toHaveLength(0);
    });

    it('a payment kind with no fulfiller is refused with a clear message', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const def: any = flow('Hi', 100);
        def.states.pay.kind = 'made_up_kind';
        const res = await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: def });
        expect(res.statusCode).toBe(422);
        expect(res.json().errors.join(' ')).toMatch(/made_up_kind/);
    });

    it('vertical default flows need a vertical; tenant flows need an existing tenant; exactly one scope', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await call('POST', '/admin/flows/main/versions', headers, { definition: flow() })).statusCode).toBe(400);
        expect((await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', vertical: 'RIDES', definition: flow() })).statusCode).toBe(400);
        prisma.tenant.findUnique.mockResolvedValue(null);
        expect((await call('POST', '/admin/flows/main/versions', headers, { tenantId: 'nope', definition: flow() })).statusCode).toBe(404);
        const ok = await call('POST', '/admin/flows/main/versions', headers, { vertical: 'RIDES', definition: flow() });
        expect(ok.statusCode).toBe(201);
        expect(rows.at(-1)).toMatchObject({ tenantId: null, vertical: 'RIDES' });
    });

    it('there is no way to edit in place: PUT/PATCH/DELETE on a version do not exist', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
            const res = await call(method, '/admin/flows/main/versions/1', headers, { definition: flow() });
            expect(res.statusCode).toBe(404);
        }
    });

    it('only an OWNER may save or activate; FINANCE/READONLY cannot even save', async () => {
        await build();
        for (const role of ['FINANCE', 'READONLY', 'SUPPORT']) {
            const { headers } = signedInAs(app, prisma, role);
            expect((await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow() })).statusCode).toBe(403);
            expect((await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 1 })).statusCode).toBe(403);
        }
        expect(rows).toHaveLength(0);
    });
});

describe('activate and roll back', () => {
    async function seedThree() {
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        for (const p of ['one', 'two', 'three']) {
            await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow(p), activate: true });
        }
        prisma.audits.length = 0;
        return { headers, row };
    }

    it('activating a version deactivates everything above it (that is the rollback)', async () => {
        await build();
        const { headers } = await seedThree();
        expect(rows.map((r) => r.isActive)).toEqual([true, true, true]);
        const res = await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 1 });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ key: 'main', activeVersion: 1, previousActiveVersion: 3, rollback: true });
        expect(rows.map((r) => r.isActive)).toEqual([true, false, false]);
        // nothing was rewritten
        expect(rows.map((r) => r.definition.states.menu.prompt)).toEqual(['one', 'two', 'three']);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'flow.version.activated', metadata: expect.objectContaining({ version: 1, previousActiveVersion: 3, rollback: true }) });
    });

    it('rolling forward again is possible', async () => {
        await build();
        const { headers } = await seedThree();
        await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 1 });
        const res = await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 3 });
        expect(res.json()).toMatchObject({ activeVersion: 3, rollback: false });
        expect(rows.find((r) => r.version === 3).isActive).toBe(true);
    });

    it('activating a draft publishes it; unknown version is 404', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        await call('POST', '/admin/flows/main/versions', headers, { tenantId: 't1', definition: flow('draft') });
        expect((await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 1 })).statusCode).toBe(200);
        expect(rows[0].isActive).toBe(true);
        expect((await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 9 })).statusCode).toBe(404);
    });

    it('a stored version that no longer validates cannot be activated (422)', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        rows.push({ id: 'bad', tenantId: 't1', vertical: null, key: 'main', version: 1, definition: { start: 'x', states: {} }, isActive: false, createdAt: new Date(), createdBy: null });
        const res = await call('POST', '/admin/flows/main/activate', headers, { tenantId: 't1', version: 1 });
        expect(res.statusCode).toBe(422);
        expect(rows[0].isActive).toBe(false);
    });
});

describe('listing', () => {
    it('lists a tenant\'s flows by key with versions, WITHOUT the definition bodies', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        rows.push(
            { id: 'a', tenantId: 't1', vertical: null, key: 'main', version: 1, definition: { big: true }, isActive: true, createdAt: new Date('2026-10-01T00:00:00Z'), createdBy: 'admin-1' },
            { id: 'b', tenantId: 't1', vertical: null, key: 'main', version: 2, definition: { big: true }, isActive: false, createdAt: new Date('2026-10-02T00:00:00Z'), createdBy: null },
            { id: 'c', tenantId: 't1', vertical: null, key: 'other', version: 1, definition: { big: true }, isActive: true, createdAt: new Date('2026-10-03T00:00:00Z'), createdBy: null },
        );
        const res = await call('GET', '/admin/flows?tenantId=t1', headers);
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j.data.map((f: any) => [f.key, f.activeVersion, f.versions.map((v: any) => v.version)])).toEqual([['main', 1, [2, 1]], ['other', 1, [1]]]);
        expect(JSON.stringify(j)).not.toContain('big');
        expect(prisma.flowDefinition.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
        expect(prisma.flowDefinition.findMany.mock.calls[0][0].select.definition).toBeUndefined();
    });

    it('lists vertical defaults', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        rows.push(
            { id: 'a', tenantId: null, vertical: 'RIDES', key: 'turbo', version: 1, definition: {}, isActive: true, createdAt: new Date(), createdBy: null },
            { id: 'b', tenantId: null, vertical: 'APPOINTMENTS', key: 'salon', version: 1, definition: {}, isActive: true, createdAt: new Date(), createdBy: null },
        );
        const res = await call('GET', '/admin/flows?vertical=RIDES', headers);
        expect(res.json().data.map((f: any) => f.key)).toEqual(['turbo']);
    });

    it('requires exactly one scope', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await call('GET', '/admin/flows', headers)).statusCode).toBe(400);
        expect((await call('GET', '/admin/flows?tenantId=t1&vertical=RIDES', headers)).statusCode).toBe(400);
    });

    it('fetches one version with its definition (for the editor); 404 when missing', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        rows.push({ id: 'a', tenantId: 't1', vertical: null, key: 'main', version: 1, definition: flow('Hi'), isActive: true, createdAt: new Date(), createdBy: null });
        const res = await call('GET', '/admin/flows/main/versions/1?tenantId=t1', headers);
        expect(res.statusCode).toBe(200);
        expect(res.json().definition.states.menu.prompt).toBe('Hi');
        expect((await call('GET', '/admin/flows/main/versions/7?tenantId=t1', headers)).statusCode).toBe(404);
    });
});
