import { describe, it, expect, beforeEach } from 'vitest';
import { createDefinitionsService, FlowDefinitionError, FlowVersionConflictError, FlowNotFoundError } from './definitions.js';
import { memoryFlowStore } from './testing.js';
import { createPrismaFlowStore } from './store.js';

const raw = (text = 'Hi') => ({
    key: 'ignored', version: 99, start: 'menu',
    states: { menu: { type: 'menu', prompt: text, options: [{ label: 'A', next: 'e' }] }, e: { type: 'end' } },
});

let mem: ReturnType<typeof memoryFlowStore>;
let svc: ReturnType<typeof createDefinitionsService>;
beforeEach(() => { mem = memoryFlowStore(); svc = createDefinitionsService(mem.store); });

describe('createVersion', () => {
    it('assigns key and version, validates, and activates by default', async () => {
        const a = await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw() });
        const b = await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw('v2') });
        expect([a.version, b.version]).toEqual([1, 2]);
        expect((b.definition as any)).toMatchObject({ key: 'main', version: 2 });
        expect(b.isActive).toBe(true);
    });

    it('rejects invalid definitions without writing anything', async () => {
        await expect(svc.createVersion({ tenantId: 't1', key: 'main', definition: { start: 'x', states: {} } })).rejects.toBeInstanceOf(FlowDefinitionError);
        await expect(svc.createVersion({ tenantId: 't1', key: 'main', definition: null })).rejects.toBeInstanceOf(FlowDefinitionError);
        expect(mem.defs).toHaveLength(0);
    });

    it('default rows need a vertical', async () => {
        await expect(svc.createVersion({ tenantId: null, key: 'main', definition: raw() })).rejects.toBeInstanceOf(FlowDefinitionError);
        const row = await svc.createVersion({ tenantId: null, vertical: 'RIDES', key: 'main', definition: raw() });
        expect(row.tenantId).toBeNull();
    });

    it('can store a draft that is not active', async () => {
        const row = await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw(), activate: false });
        expect(row.isActive).toBe(false);
        expect(await svc.loadActive({ tenantId: 't1' }, 'main')).toBeNull();
    });

    it('keeps versions per scope independent (tenant vs default)', async () => {
        await svc.createVersion({ tenantId: null, vertical: 'RIDES', key: 'main', definition: raw() });
        const t = await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw() });
        expect(t.version).toBe(1);
    });

    it('enforces (key, version) uniqueness for default rows when a concurrent twin sneaks in', async () => {
        // Simulate the race: another creator inserts version 1 between our read and our insert.
        const realInsert = mem.store.insert.bind(mem.store);
        let injected = false;
        mem.store.insert = async (row) => {
            if (!injected) {
                injected = true;
                await realInsert({ ...row, definition: { other: true } }); // lower id wins
            }
            return realInsert(row);
        };
        await expect(svc.createVersion({ tenantId: null, vertical: 'RIDES', key: 'main', definition: raw() })).rejects.toBeInstanceOf(FlowVersionConflictError);
        const rows = await svc.listVersions({ tenantId: null }, 'main');
        expect(rows).toHaveLength(1);
    });

    it('refuses an existing version number even if the store already holds it', async () => {
        await svc.createVersion({ tenantId: null, vertical: 'RIDES', key: 'main', definition: raw() });
        // stale read: pretend findVersions misses the row once
        const real = mem.store.findVersions.bind(mem.store);
        let first = true;
        mem.store.findVersions = async (s, k) => { if (first) { first = false; return []; } return real(s, k); };
        await expect(svc.createVersion({ tenantId: null, vertical: 'RIDES', key: 'main', definition: raw() })).rejects.toBeInstanceOf(FlowVersionConflictError);
        expect(await svc.listVersions({ tenantId: null }, 'main')).toHaveLength(1);
    });
});

describe('activate / load / list', () => {
    it('loadActive returns the highest active version; activateVersion rolls back', async () => {
        await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw('one') });
        await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw('two') });
        expect((await svc.loadActive({ tenantId: 't1' }, 'main'))?.version).toBe(2);
        await svc.activateVersion({ tenantId: 't1' }, 'main', 1);
        expect((await svc.loadActive({ tenantId: 't1' }, 'main'))?.version).toBe(1);
        await svc.activateVersion({ tenantId: 't1' }, 'main', 2);
        expect((await svc.loadActive({ tenantId: 't1' }, 'main'))?.version).toBe(2);
    });

    it('errors on unknown versions and can deactivate', async () => {
        await expect(svc.activateVersion({ tenantId: 't1' }, 'main', 5)).rejects.toBeInstanceOf(FlowNotFoundError);
        await expect(svc.deactivateVersion({ tenantId: 't1' }, 'main', 5)).rejects.toBeInstanceOf(FlowNotFoundError);
        await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw() });
        await svc.deactivateVersion({ tenantId: 't1' }, 'main', 1);
        expect(await svc.loadActive({ tenantId: 't1' }, 'main')).toBeNull();
    });

    it('does not leak across tenants', async () => {
        await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw() });
        expect(await svc.list({ tenantId: 't2' })).toEqual([]);
        expect(await svc.loadActive({ tenantId: 't2' }, 'main')).toBeNull();
    });

    it('a published version is never edited: definitions are only ever added', async () => {
        const a = await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw('one') });
        await svc.createVersion({ tenantId: 't1', key: 'main', definition: raw('two') });
        expect((await svc.getVersion({ tenantId: 't1' }, 'main', 1))?.definition).toEqual(a.definition);
    });
});

describe('createPrismaFlowStore', () => {
    function fake() {
        const calls: Array<[string, any]> = [];
        const rec = (name: string, ret: any) => async (args: any) => { calls.push([name, args]); return typeof ret === 'function' ? ret(args) : ret; };
        const prisma: any = {
            flowDefinition: { findFirst: rec('fd.findFirst', null), findMany: rec('fd.findMany', []), create: rec('fd.create', (a: any) => ({ id: 'x', ...a.data })), delete: rec('fd.delete', {}), updateMany: rec('fd.updateMany', { count: 1 }) },
            conversation: { findFirst: rec('c.findFirst', { id: 'c1', customerPhone: null, botContext: null, contextVersion: 3 }), updateMany: rec('c.updateMany', { count: 1 }) },
        };
        return { prisma, calls };
    }

    it('saves with a compare-and-set on contextVersion scoped by tenant, and reports conflicts', async () => {
        const { prisma, calls } = fake();
        const store = createPrismaFlowStore(prisma);
        expect(await store.saveBotContext('t1', 'c1', 3, { flow: {} })).toBe(true);
        expect(calls[0][1]).toEqual({ where: { id: 'c1', tenantId: 't1', contextVersion: 3 }, data: { botContext: { flow: {} }, contextVersion: { increment: 1 } } });
        prisma.conversation.updateMany = async () => ({ count: 0 });
        expect(await store.saveBotContext('t1', 'c1', 3, {})).toBe(false);
    });

    it('loads conversations by id AND tenant', async () => {
        const { prisma, calls } = fake();
        const c = await createPrismaFlowStore(prisma).loadConversation('t1', 'c1');
        expect(c).toEqual({ id: 'c1', customerPhone: null, botContext: null, contextVersion: 3 });
        expect(calls[0][1].where).toEqual({ id: 'c1', tenantId: 't1' });
    });

    it('definition lookup tries tenant rows then default rows (tenantId null) and pins versions', async () => {
        const { prisma, calls } = fake();
        const store = createPrismaFlowStore(prisma);
        await store.findDefinition({ tenantId: 't1', vertical: 'RIDES', key: 'k' });
        expect(calls[0][1].where).toEqual({ tenantId: 't1', key: 'k', isActive: true });
        expect(calls[1][1].where).toEqual({ tenantId: null, vertical: 'RIDES', key: 'k', isActive: true });
        calls.length = 0;
        await store.findDefinition({ tenantId: 't1', vertical: 'RIDES', key: null });
        expect(calls).toHaveLength(1);
        expect(calls[0][1].where).toEqual({ tenantId: null, vertical: 'RIDES', isActive: true });
        calls.length = 0;
        await store.findDefinition({ tenantId: 't1', vertical: '', key: 'k', version: 2 });
        expect(calls[0][1].where).toEqual({ tenantId: 't1', key: 'k', version: 2 });
        expect(calls[1][1].where).toEqual({ tenantId: null, key: 'k', version: 2 });
    });

    it('setActive scopes by tenant and key', async () => {
        const { prisma, calls } = fake();
        const store = createPrismaFlowStore(prisma);
        await store.setActive({ tenantId: null }, 'k', { versionAbove: 2 }, false);
        expect(calls[0][1]).toEqual({ where: { tenantId: null, key: 'k', version: { gt: 2 } }, data: { isActive: false } });
    });
});
