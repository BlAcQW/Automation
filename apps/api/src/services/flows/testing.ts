/**
 * Fakes for flow tests (also usable by the wiring agent's tests). No DB, no
 * network: every port records its calls and returns a scripted result.
 */
import type { DefinitionRow, DefinitionScope, DefinitionStore } from './definitions.js';
import type { DefinitionQuery, FlowStore, LoadedConversation, StoredDefinition } from './runner.js';
import type { FlowMeta, FlowPorts, PaymentLinkRequest, StaffRequest, ActionRequest, ActionResult } from './engine.js';

export interface FakePortsOptions {
    paymentLink?: (req: PaymentLinkRequest) => { url: string; reference?: string } | null;
    actions?: Record<string, (req: ActionRequest) => ActionResult>;
    failStaff?: boolean;
}

export function fakePorts(opts: FakePortsOptions = {}) {
    const calls = {
        payments: [] as PaymentLinkRequest[],
        staff: [] as StaffRequest[],
        actions: [] as ActionRequest[],
    };
    const ports: FlowPorts = {
        async createPaymentLink(req) {
            calls.payments.push(req);
            return opts.paymentLink
                ? opts.paymentLink(req)
                : { url: `https://pay.test/${req.kind}/${calls.payments.length}`, reference: `ref_${calls.payments.length}` };
        },
        async enqueueStaff(req) {
            calls.staff.push(req);
            if (opts.failStaff) throw new Error('queue down');
        },
        async runAction(req) {
            calls.actions.push(req);
            const fn = opts.actions?.[req.name];
            if (!fn) return { ok: false };
            return fn(req);
        },
    };
    return { ports, calls };
}

export const testMeta: FlowMeta = {
    tenantId: 't1',
    conversationId: 'c1',
    customerPhone: '+233241234567',
    currency: 'GHS',
};

// ---------------------------------------------------------------- in-memory stores


export interface MemoryFlowStoreOptions {
    /** Called just before each saveBotContext; use it to simulate a concurrent writer. */
    beforeSave?: (conversationId: string, attempt: number) => void;
}

export function memoryFlowStore(
    seed: { definitions?: DefinitionRow[]; conversations?: LoadedConversation[] } = {},
    opts: MemoryFlowStoreOptions = {},
) {
    const defs: DefinitionRow[] = [...(seed.definitions ?? [])];
    const convs = new Map((seed.conversations ?? []).map((c) => [c.id, { ...c }]));
    let saves = 0;
    let nextId = 1;

    const store: FlowStore & DefinitionStore = {
        async findDefinition(q: DefinitionQuery): Promise<StoredDefinition | null> {
            const pickable = (r: DefinitionRow) => (q.version !== undefined ? r.version === q.version : r.isActive);
            const best = (rows: DefinitionRow[]) => rows.sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version)[0];
            if (q.key !== null) {
                const own = best(defs.filter((r) => r.tenantId === q.tenantId && r.key === q.key && pickable(r)));
                if (own) return { key: own.key, version: own.version, definition: own.definition };
            }
            const d = best(defs.filter((r) => r.tenantId === null && (!q.vertical || r.vertical === q.vertical) && (q.key === null || r.key === q.key) && pickable(r)));
            return d ? { key: d.key, version: d.version, definition: d.definition } : null;
        },
        async loadConversation(_t, id) {
            const c = convs.get(id);
            return c ? { ...c } : null;
        },
        async saveBotContext(_t, id, expected, botContext) {
            opts.beforeSave?.(id, saves++);
            const c = convs.get(id);
            if (!c || c.contextVersion !== expected) return false;
            convs.set(id, { ...c, botContext, contextVersion: c.contextVersion + 1 });
            return true;
        },
        async findVersions(scope: DefinitionScope, key) {
            return defs.filter((r) => r.tenantId === scope.tenantId && r.key === key).sort((a, b) => a.version - b.version);
        },
        async list(scope) {
            return defs.filter((r) => r.tenantId === scope.tenantId);
        },
        async insert(row) {
            const full: DefinitionRow = { ...row, id: `fd_${String(nextId++).padStart(4, '0')}`, createdAt: new Date() };
            defs.push(full);
            return full;
        },
        async remove(id) {
            const i = defs.findIndex((r) => r.id === id);
            if (i >= 0) defs.splice(i, 1);
        },
        async setActive(scope, key, which, isActive) {
            defs.forEach((r, i) => {
                if (r.tenantId !== scope.tenantId || r.key !== key) return;
                const hit = 'version' in which ? r.version === which.version : r.version > which.versionAbove;
                if (hit) defs[i] = { ...r, isActive };
            });
        },
    };
    return {
        store,
        defs,
        conversation: (id: string) => convs.get(id)!,
        /** Simulate another writer bumping the row. */
        bump: (id: string, botContext?: unknown) => {
            const c = convs.get(id)!;
            convs.set(id, { ...c, contextVersion: c.contextVersion + 1, botContext: botContext ?? c.botContext });
        },
    };
}

export function defRow(over: Partial<DefinitionRow> & { definition: unknown }): DefinitionRow {
    return {
        id: `r_${Math.random().toString(36).slice(2)}`, tenantId: null, vertical: 'RIDES', key: 'f', version: 1,
        isActive: true, createdAt: new Date(), createdBy: null, ...over,
    };
}
