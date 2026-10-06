import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runFlowTurn, advanceFlow, readFlowState, FLOW_CONFLICT_REPLY, type FlowRunnerDeps } from './runner.js';
import { fakePorts, memoryFlowStore, defRow } from './testing.js';
import { registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../payment-fulfillers.js';
import { resetFlowActionsForTests } from './actions.js';

const flow = (version: number, greeting: string) => ({
    key: 'f', version, start: 'menu',
    states: {
        menu: { type: 'menu', prompt: greeting, options: [{ label: 'Pay', next: 'pay' }, { label: 'Name', next: 'name' }] },
        name: { type: 'ask', prompt: 'Name?', validate: 'name', var: 'n', next: 'bye' },
        pay: { type: 'payment', kind: 'ride_package', amount: 10, prompt: 'Pay {payment_url}', onSuccess: 'ok' },
        ok: { type: 'end', text: 'Thanks' },
        bye: { type: 'notify', text: 'Hi {n}', next: 'fin' },
        fin: { type: 'end', text: 'Bye' },
    },
});

const tenant = { id: 't1', vertical: 'RIDES', activeFlowKey: null as string | null };
const conv = (over: Record<string, unknown> = {}) => ({ id: 'c1', customerPhone: '+233241234567', botContext: null as unknown, contextVersion: 0, ...over });
let n = 0;
const inbound = (text: string, id?: string) => ({ inboundId: id ?? `m${++n}`, text });

beforeEach(() => {
    n = 0;
    resetPaymentFulfillersForTests(); resetFlowActionsForTests();
    registerPaymentFulfiller('ride_package', async () => ({ status: 'applied' }));
});

function setup(opts: { defs?: ReturnType<typeof defRow>[]; botContext?: unknown; beforeSave?: (id: string, attempt: number) => void } = {}) {
    const mem = memoryFlowStore(
        { definitions: opts.defs ?? [defRow({ version: 1, definition: flow(1, 'Hello v1') })], conversations: [conv({ botContext: opts.botContext })] },
        { beforeSave: opts.beforeSave },
    );
    const f = fakePorts();
    const log = { warn: vi.fn(), error: vi.fn() };
    const deps: FlowRunnerDeps = { store: mem.store, ports: f.ports, log };
    return { mem, f, deps, log };
}

describe('runFlowTurn', () => {
    it('returns an AgentResult-shaped reply, persists state and bumps contextVersion', async () => {
        const { mem, deps } = setup();
        const r = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
        expect(r).toEqual({ reply: 'Hello v1\n\n1. Pay\n2. Name', wantsHuman: false, toolsUsed: [], completed: null });
        expect(mem.conversation('c1').contextVersion).toBe(1);
        expect(readFlowState(mem.conversation('c1').botContext)).toMatchObject({ flowKey: 'f', flowVersion: 1, current: 'menu' });
    });

    it('joins multiple replies into one message', async () => {
        const { mem, deps } = setup();
        let c = mem.conversation('c1');
        await runFlowTurn(deps, { tenant, conversation: c, inbound: inbound('hi') });
        c = mem.conversation('c1');
        await runFlowTurn(deps, { tenant, conversation: c, inbound: inbound('2') });
        c = mem.conversation('c1');
        const r = await runFlowTurn(deps, { tenant, conversation: c, inbound: inbound('Ama') });
        expect(r.reply).toBe('Hi Ama\n\nBye');
    });

    it('reports completion when a turn takes the flow to its end, and not before', async () => {
        const { mem, deps } = setup();
        const first = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
        expect(first.completed).toBeNull();
        await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('2') });
        const last = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('Ama') });
        expect(last.completed).toEqual({ flowKey: 'f', version: 1, vars: {} });
    });

    it('keeps other botContext keys', async () => {
        const { mem, deps } = setup({ botContext: { other: 1 } });
        await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
        expect((mem.conversation('c1').botContext as any).other).toBe(1);
    });

    it('is idempotent per inbound: a replay sends nothing and saves nothing', async () => {
        const { mem, deps } = setup();
        const i = inbound('hi');
        await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: i });
        const v = mem.conversation('c1').contextVersion;
        const again = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: i });
        expect(again).toEqual({ reply: '', wantsHuman: false, toolsUsed: [] });
        expect(mem.conversation('c1').contextVersion).toBe(v);
    });

    it('reports tools used and wantsHuman after three misses', async () => {
        const { mem, deps } = setup();
        await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
        const pay = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('1') });
        expect(pay.toolsUsed).toEqual(['flow:payment_link']);
        // restart (waiting payment ignores misses), so test misses on a fresh conversation
        const s2 = setup();
        await runFlowTurn(s2.deps, { tenant, conversation: s2.mem.conversation('c1'), inbound: inbound('hi') });
        let last = { wantsHuman: false } as { wantsHuman: boolean };
        for (let i = 0; i < 3; i++) last = await runFlowTurn(s2.deps, { tenant, conversation: s2.mem.conversation('c1'), inbound: inbound('???') });
        expect(last.wantsHuman).toBe(true);
    });

    describe('definition resolution', () => {
        it('uses the highest ACTIVE default version for the vertical', async () => {
            const { mem, deps } = setup({ defs: [
                defRow({ version: 1, definition: flow(1, 'v1') }),
                defRow({ version: 2, definition: flow(2, 'v2') }),
                defRow({ version: 3, definition: flow(3, 'v3'), isActive: false }),
                defRow({ key: 'other', version: 9, vertical: 'APPOINTMENTS', definition: { ...flow(9, 'nope'), key: 'other' } }),
            ] });
            const r = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
            expect(r.reply).toMatch(/^v2/);
        });

        it('prefers the tenant activeFlowKey (tenant rows first, then defaults)', async () => {
            const { mem, deps } = setup({ defs: [
                defRow({ key: 'f', version: 1, definition: flow(1, 'default') }),
                defRow({ tenantId: 't1', key: 'mine', version: 4, definition: { ...flow(4, 'tenant own'), key: 'mine' } }),
            ] });
            const r = await runFlowTurn(deps, { tenant: { ...tenant, activeFlowKey: 'mine' }, conversation: mem.conversation('c1'), inbound: inbound('hi') });
            expect(r.reply).toMatch(/^tenant own/);
            const other = setup({ defs: [
                defRow({ key: 'f', version: 1, definition: flow(1, 'default') }),
                defRow({ tenantId: 't1', key: 'mine', version: 4, definition: { ...flow(4, 'tenant own'), key: 'mine' } }),
            ] });
            const d = await runFlowTurn(other.deps, { tenant: { ...tenant, activeFlowKey: 'f' }, conversation: other.mem.conversation('c1'), inbound: inbound('hi2') });
            expect(d.reply).toMatch(/^default/);
        });

        it('does not use another tenant\'s definition', async () => {
            const { mem, deps } = setup({ defs: [defRow({ tenantId: 'other', key: 'mine', definition: { ...flow(1, 'theirs'), key: 'mine' } })] });
            const r = await runFlowTurn(deps, { tenant: { ...tenant, activeFlowKey: 'mine' }, conversation: mem.conversation('c1'), inbound: inbound('hi') });
            expect(r.wantsHuman).toBe(true);
        });

        it('keeps an in-flight conversation on its pinned version after a new one is published', async () => {
            const { mem, deps } = setup({ defs: [defRow({ version: 1, definition: flow(1, 'v1') })] });
            await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
            mem.defs.push(defRow({ version: 2, definition: flow(2, 'v2') }));
            // wrong answer re-prompts from v1, not v2
            const r = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('??') });
            expect(r.reply).toMatch(/v1/);
            expect(r.reply).not.toMatch(/v2/);
            // finish the flow, then the next contact starts v2
            await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('2') });
            await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('Ama') });
            const fresh = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('again') });
            expect(fresh.reply).toMatch(/^v2/);
        });

        it('fails safe (hand to a human, logged) when there is no definition or it is invalid', async () => {
            const none = setup({ defs: [] });
            const r = await runFlowTurn(none.deps, { tenant, conversation: none.mem.conversation('c1'), inbound: inbound('hi') });
            expect(r).toEqual({ reply: '', wantsHuman: true, toolsUsed: ['flow:unavailable'] });
            expect(none.log.error).toHaveBeenCalled();

            const bad = setup({ defs: [defRow({ definition: { key: 'f', version: 1, start: 'x', states: {} } })] });
            const r2 = await runFlowTurn(bad.deps, { tenant, conversation: bad.mem.conversation('c1'), inbound: inbound('hi') });
            expect(r2.wantsHuman).toBe(true);
            expect(bad.log.error).toHaveBeenCalled();
        });

        it('treats corrupt stored state as a fresh start', async () => {
            const { mem, deps } = setup({ botContext: { flow: { nonsense: true } } });
            const r = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
            expect(r.reply).toMatch(/Hello v1/);
        });
    });

    describe('optimistic lock', () => {
        it('re-runs once from the fresh row after losing the race', async () => {
            let bumped = false;
            const { mem, deps } = setup({ beforeSave: (id) => { if (!bumped) { bumped = true; mem.bump(id); } } });
            const stale = mem.conversation('c1');
            const r = await runFlowTurn(deps, { tenant, conversation: stale, inbound: inbound('hi') });
            expect(r.wantsHuman).toBe(false);
            expect(r.reply).toMatch(/Hello v1/);
            expect(mem.conversation('c1').contextVersion).toBe(2);
        });

        it('if the racing writer already handled this inbound, the retry sends nothing', async () => {
            const i = inbound('hi');
            let first = true;
            const { mem, deps } = setup({ beforeSave: (id) => {
                if (!first) return;
                first = false;
                // someone else processed the same inbound and saved
                const state = { flowKey: 'f', flowVersion: 1, current: 'menu', status: 'active', vars: {}, misses: 0, lastInboundId: i.inboundId, lastEventId: null };
                mem.bump(id, { flow: state });
            } });
            const r = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: i });
            expect(r).toEqual({ reply: '', wantsHuman: false, toolsUsed: [] });
        });

        it('hands off after two lost races', async () => {
            const { mem, deps, log } = setup({ beforeSave: (id) => mem.bump(id) });
            const r = await runFlowTurn(deps, { tenant, conversation: mem.conversation('c1'), inbound: inbound('hi') });
            expect(r).toEqual({ reply: FLOW_CONFLICT_REPLY, wantsHuman: true, toolsUsed: ['flow:conflict'] });
            expect(log.error).toHaveBeenCalled();
        });
    });
});

describe('advanceFlow', () => {
    async function waiting() {
        const s = setup();
        await runFlowTurn(s.deps, { tenant, conversation: s.mem.conversation('c1'), inbound: inbound('hi') });
        await runFlowTurn(s.deps, { tenant, conversation: s.mem.conversation('c1'), inbound: inbound('1') });
        return s;
    }

    it('moves a waiting payment forward and persists', async () => {
        const { mem, deps } = await waiting();
        const r = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded', eventId: 'e1', kind: 'ride_package' } });
        expect(r).toEqual({ applied: true, reply: 'Thanks', wantsHuman: false, completed: { flowKey: 'f', version: 1, vars: {} } });
        expect(readFlowState(mem.conversation('c1').botContext)?.status).toBe('ended');
    });

    it('ignores a duplicate event, and events for conversations not waiting', async () => {
        const { deps } = await waiting();
        await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded', eventId: 'e1' } });
        const dup = await advanceFlow(deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded', eventId: 'e1' } });
        expect(dup).toEqual({ applied: false, reply: '', wantsHuman: false });
        const idle = setup();
        const r = await advanceFlow(idle.deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded' } });
        expect(r.applied).toBe(false);
        const ghost = await advanceFlow(idle.deps, { tenantId: 't1', conversationId: 'nope', event: { type: 'payment.succeeded' } });
        expect(ghost.applied).toBe(false);
    });

    it('retries once after a lost race and succeeds', async () => {
        let bumped = false;
        const s = await waiting();
        const store = { ...s.mem.store, saveBotContext: async (t: string, id: string, v: number, b: Record<string, unknown>) => {
            if (!bumped) { bumped = true; s.mem.bump(id); }
            return s.mem.store.saveBotContext(t, id, v, b);
        } };
        const r = await advanceFlow({ ...s.deps, store }, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded' } });
        expect(r.applied).toBe(true);
    });

    it('still finishes a waiting payment after the definition moved to a new version', async () => {
        const s = await waiting();
        s.mem.defs.push(defRow({ version: 2, definition: { ...flow(2, 'v2'), states: { ...flow(2, 'v2').states, ok: { type: 'end', text: 'v2 thanks' } } } }));
        const r = await advanceFlow(s.deps, { tenantId: 't1', conversationId: 'c1', event: { type: 'payment.succeeded' } });
        expect(r.reply).toBe('Thanks');
    });
});
