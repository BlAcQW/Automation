/**
 * What a scripted flow should do when staff hand a conversation back to the bot.
 *
 * A person can take over at any point: in the middle of a question ("What's
 * your full name?"), or while the flow waits on a payment. On the way back:
 *
 *  - mid-question (status 'active'): the question is stale. The person has
 *    dealt with the customer since, so their next "thanks" must not be read as
 *    the answer to it. The flow is marked 'handed_off', which the engine treats
 *    as finished, so the next message starts at the flow's start (the menu).
 *  - waiting on a payment: kept as is, so a payment that lands later still
 *    finds its step (the reason resume never clears botContext). Only the
 *    counters are cleared.
 *  - in both cases `misses` goes back to 0: a stale count would hand the
 *    customer straight back to a person on their first unclear message, the
 *    flow twin of the botFailureCount reset the resume routes already do.
 */
import { readFlowState } from './runner.js';
import type { FlowState } from './types.js';

/** The botContext to store on hand-back, or null when nothing needs to change. */
export function flowContextForHandBack(botContext: unknown): Record<string, unknown> | null {
    const state = readFlowState(botContext);
    if (!state) return null;
    let next: FlowState;
    if (state.status === 'active') {
        next = { ...state, status: 'handed_off', misses: 0 };
    } else if (state.status === 'waiting' && (state.misses > 0 || (state.waitingMessages ?? 0) > 0)) {
        next = { ...state, misses: 0, waitingMessages: 0 };
    } else {
        return null;
    }
    return { ...(botContext as Record<string, unknown>), flow: next };
}

type Fn = (args: any) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface HandBackPrismaLike {
    conversation: { findFirst: Fn; updateMany: Fn };
}

const ATTEMPTS = 2;

/**
 * Apply flowContextForHandBack to a conversation a person still has, BEFORE it
 * is flipped back to the bot (so no flow turn can run on the old state in
 * between). Compare-and-set on contextVersion, like every flow state write; on
 * a lost race (a payment event moved the flow) it re-reads and tries once more.
 * Returns true when it wrote. Never throws for a missing or already-resumed
 * conversation: the caller's own state flip decides the outcome.
 */
export async function prepareFlowForHandBack(prisma: HandBackPrismaLike, tenantId: string, conversationId: string): Promise<boolean> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const row = await prisma.conversation.findFirst({
            where: { id: conversationId, tenantId },
            select: { botContext: true, contextVersion: true, state: true },
        });
        if (!row || row.state !== 'HUMAN_ACTIVE') return false;
        const botContext = flowContextForHandBack(row.botContext);
        if (!botContext) return false;
        const { count } = await prisma.conversation.updateMany({
            where: { id: conversationId, tenantId, state: 'HUMAN_ACTIVE', contextVersion: row.contextVersion },
            data: { botContext, contextVersion: { increment: 1 } },
        });
        if (count === 1) return true;
    }
    return false;
}
