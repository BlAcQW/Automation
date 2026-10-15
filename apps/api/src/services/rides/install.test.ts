import { describe, it, expect, vi } from 'vitest';
import { resetActiveFlowConversations } from './install.js';

const flow = (over: Record<string, unknown>) => ({
    flow: { flowKey: 'turbo-founding', flowVersion: 1, current: 'book_dest', status: 'active', vars: { x: '1' }, misses: 2, lastInboundId: 'm1', ...over },
    other: 'kept',
});

function fakeDb(rows: Array<{ id: string; botContext: unknown; contextVersion: number }>, count = 1) {
    return {
        conversation: {
            findMany: vi.fn(async () => rows),
            updateMany: vi.fn(async () => ({ count })),
        },
    };
}

describe('resetActiveFlowConversations (publishing a new TURBO flow version)', () => {
    it('hands back conversations mid-flow on an older version; their next message starts the new version', async () => {
        const db = fakeDb([{ id: 'c1', botContext: flow({}), contextVersion: 4 }]);
        expect(await resetActiveFlowConversations(db as any, { tenantId: 't1', flowKey: 'turbo-founding', version: 2 })).toBe(1);
        expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 't1', botContext: { path: ['flow', 'flowKey'], equals: 'turbo-founding' } },
        }));
        expect(db.conversation.updateMany).toHaveBeenCalledWith({
            where: { id: 'c1', tenantId: 't1', contextVersion: 4 },
            data: { botContext: { other: 'kept', flow: expect.objectContaining({ status: 'handed_off', misses: 0, flowVersion: 1 }) }, contextVersion: { increment: 1 } },
        });
    });

    it('leaves alone: a conversation waiting on a payment, one already on the new version, another flow, ended flows', async () => {
        const db = fakeDb([
            { id: 'w', botContext: flow({ status: 'waiting' }), contextVersion: 1 },
            { id: 'n', botContext: flow({ flowVersion: 2 }), contextVersion: 1 },
            { id: 'o', botContext: flow({ flowKey: 'other' }), contextVersion: 1 },
            { id: 'e', botContext: flow({ status: 'ended' }), contextVersion: 1 },
            { id: 'j', botContext: 'junk', contextVersion: 1 },
        ]);
        expect(await resetActiveFlowConversations(db as any, { tenantId: 't1', flowKey: 'turbo-founding', version: 2 })).toBe(0);
        expect(db.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('a conversation that moved meanwhile (lost compare-and-set) is not counted', async () => {
        const db = fakeDb([{ id: 'c1', botContext: flow({}), contextVersion: 4 }], 0);
        expect(await resetActiveFlowConversations(db as any, { tenantId: 't1', flowKey: 'turbo-founding', version: 2 })).toBe(0);
    });
});
