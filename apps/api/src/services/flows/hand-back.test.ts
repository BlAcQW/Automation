import { describe, it, expect, vi } from 'vitest';
import { flowContextForHandBack, prepareFlowForHandBack } from './hand-back.js';

const flow = (over: Record<string, unknown> = {}) => ({
    flowKey: 'turbo-founding', flowVersion: 1, current: 'reg_name', status: 'active',
    vars: { pkg_price: '960' }, misses: 2, lastInboundId: 'wamid.1', lastEventId: null, ...over,
});

describe('flowContextForHandBack', () => {
    it('a flow stopped mid-question restarts at its start on the next message (handed_off, misses cleared)', () => {
        const next = flowContextForHandBack({ other: 'kept', flow: flow() });
        expect(next).toEqual({ other: 'kept', flow: { ...flow(), status: 'handed_off', misses: 0 } });
    });

    it('a flow waiting on a payment keeps waiting, with its counters cleared', () => {
        const waiting = flow({ current: 'pay', status: 'waiting', misses: 1, waitingMessages: 3 });
        expect(flowContextForHandBack({ flow: waiting })).toEqual({ flow: { ...waiting, misses: 0, waitingMessages: 0 } });
    });

    it('changes nothing when there is nothing to change', () => {
        expect(flowContextForHandBack(null)).toBeNull();
        expect(flowContextForHandBack({ secret: 'internal' })).toBeNull();
        expect(flowContextForHandBack({ flow: flow({ status: 'handed_off' }) })).toBeNull();
        expect(flowContextForHandBack({ flow: flow({ status: 'ended' }) })).toBeNull();
        expect(flowContextForHandBack({ flow: flow({ status: 'waiting', misses: 0, waitingMessages: 0 }) })).toBeNull();
        expect(flowContextForHandBack({ flow: { not: 'a flow state' } })).toBeNull();
    });
});

describe('prepareFlowForHandBack', () => {
    const row = (over: Record<string, unknown> = {}) => ({ botContext: { flow: flow() }, contextVersion: 4, state: 'HUMAN_ACTIVE', ...over });

    function prismaWith(rows: Array<Record<string, unknown> | null>, counts: number[] = [1]) {
        return {
            conversation: {
                findFirst: vi.fn(async () => rows.shift() ?? null),
                updateMany: vi.fn(async () => ({ count: counts.shift() ?? 1 })),
            },
        };
    }

    it('writes the new context with a compare-and-set on contextVersion, only while a person has the chat', async () => {
        const prisma = prismaWith([row()]);
        expect(await prepareFlowForHandBack(prisma, 't1', 'c1')).toBe(true);
        expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 't1' } }));
        expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
            where: { id: 'c1', tenantId: 't1', state: 'HUMAN_ACTIVE', contextVersion: 4 },
            data: { botContext: { flow: { ...flow(), status: 'handed_off', misses: 0 } }, contextVersion: { increment: 1 } },
        });
    });

    it('writes nothing when the context needs no change', async () => {
        const prisma = prismaWith([row({ botContext: null })]);
        expect(await prepareFlowForHandBack(prisma, 't1', 'c1')).toBe(false);
        expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('re-reads and retries once when the context changed underneath (a payment event)', async () => {
        const prisma = prismaWith([row(), row({ contextVersion: 5 })], [0, 1]);
        expect(await prepareFlowForHandBack(prisma, 't1', 'c1')).toBe(true);
        expect(prisma.conversation.updateMany).toHaveBeenCalledTimes(2);
        expect((prisma.conversation.updateMany.mock.calls[1] as any)[0].where.contextVersion).toBe(5);
    });

    it('gives up quietly when the conversation is gone or no longer with a person', async () => {
        expect(await prepareFlowForHandBack(prismaWith([null]), 't1', 'c1')).toBe(false);
        const prisma = prismaWith([row({ state: 'BOT_ACTIVE' })]);
        expect(await prepareFlowForHandBack(prisma, 't1', 'c1')).toBe(false);
        expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    });
});
