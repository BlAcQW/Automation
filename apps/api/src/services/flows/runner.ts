/**
 * Runner: connects the pure engine to a conversation.
 *
 * `runFlowTurn` is the entry point for the conversation seam. It returns the
 * same shape as the LLM agent (`AgentResult`: reply / wantsHuman / toolsUsed)
 * so the seam can swap one for the other.
 *
 *  - Replies: when one turn produces several replies (e.g. "Paid!" + the next
 *    menu) they are joined with a blank line into ONE message. One send keeps
 *    the order atomic with the reply outbox, and costs one WhatsApp message.
 *  - State: Conversation.botContext.flow, saved with an optimistic lock on
 *    Conversation.contextVersion. On a lost race the turn is re-run once from
 *    the fresh row; a second loss hands the conversation to a human. Side
 *    effects carry idempotency keys (see engine.ts) so a re-run cannot double
 *    charge or double-queue if the real ports honour them.
 *  - A replayed inbound id returns an empty reply and wantsHuman=false: the
 *    seam must treat an empty reply as "send nothing".
 *  - A flow that handed off restarts at its start state if the customer later
 *    resumes the bot (the seam only calls the runner while the bot is in charge).
 */
import { step, advance, type FlowCompletion, type FlowInput, type FlowMeta, type FlowPorts, type FlowEvent, type FlowEffect, type StepResult } from './engine.js';
import { parseFlowDefinition } from './validate.js';
import { flowStateSchema, type FlowDefinition, type FlowState } from './types.js';

export const FLOW_CONFLICT_REPLY = "Sorry, I'm having trouble right now. Someone from the team will reply shortly.";
export const DEFAULT_CURRENCY = 'GHS';

export interface StoredDefinition {
    key: string;
    version: number;
    definition: unknown;
}

export interface DefinitionQuery {
    tenantId: string;
    vertical: string;
    /** null = the vertical's default flow. */
    key: string | null;
    /**
     * Given: exactly that version (active or not, so in-flight conversations
     * finish on the version they started). Absent: the highest ACTIVE version.
     * The tenant's own rows win over default rows (tenantId null).
     */
    version?: number;
}

export interface LoadedConversation {
    id: string;
    customerPhone: string | null;
    botContext: unknown;
    contextVersion: number;
}

/** Persistence port. `createPrismaFlowStore` (store.ts) is the real one. */
export interface FlowStore {
    findDefinition(q: DefinitionQuery): Promise<StoredDefinition | null>;
    loadConversation(tenantId: string, conversationId: string): Promise<LoadedConversation | null>;
    /** Compare-and-set on contextVersion. true = saved (version incremented). */
    saveBotContext(tenantId: string, conversationId: string, expectedVersion: number, botContext: Record<string, unknown>): Promise<boolean>;
}

export interface FlowLogger {
    warn(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
}

export interface FlowRunnerDeps {
    store: FlowStore;
    ports: FlowPorts;
    defaultCurrency?: string;
    log?: FlowLogger;
}

export interface FlowTenant {
    id: string;
    vertical: string;
    activeFlowKey: string | null;
    currency?: string | null;
}

export interface FlowTurnArgs {
    tenant: FlowTenant;
    conversation: LoadedConversation;
    inbound: FlowInput;
}

/** Same shape as the LLM agent's AgentResult. */
export interface FlowTurnResult {
    reply: string;
    wantsHuman: boolean;
    toolsUsed: string[];
    /** Set when this turn took the flow to its end (the caller announces flow.completed). */
    completed?: FlowCompletion | null;
}

export interface AdvanceFlowArgs {
    tenantId: string;
    conversationId: string;
    event: FlowEvent;
    /** Vertical / key are only needed if the pinned definition version is gone. */
    vertical?: string;
    currency?: string | null;
}

export interface AdvanceFlowResult {
    applied: boolean;
    /** Messages joined for sending; '' when nothing to send. */
    reply: string;
    wantsHuman: boolean;
    /** Set when this event took the flow to its end. */
    completed?: FlowCompletion | null;
}

export function readFlowState(botContext: unknown): FlowState | null {
    if (typeof botContext !== 'object' || botContext === null) return null;
    const parsed = flowStateSchema.safeParse((botContext as Record<string, unknown>).flow);
    return parsed.success ? parsed.data : null;
}

function withFlowState(botContext: unknown, state: FlowState): Record<string, unknown> {
    const others = typeof botContext === 'object' && botContext !== null && !Array.isArray(botContext) ? botContext : {};
    return { ...(others as Record<string, unknown>), flow: state };
}

function toolsUsed(effects: FlowEffect[]): string[] {
    const out: string[] = [];
    for (const e of effects) {
        if (e.type === 'payment_link_created') out.push('flow:payment_link');
        else if (e.type === 'staff_queued') out.push('flow:staff_queue');
        else if (e.type === 'action_ran' && e.ok) out.push(`flow:action:${e.name}`);
    }
    return out;
}

function parseStored(deps: FlowRunnerDeps, row: StoredDefinition | null, tenantId: string): FlowDefinition | null {
    if (!row) return null;
    const parsed = parseFlowDefinition(row.definition);
    if (!parsed.ok) {
        deps.log?.error({ tenantId, key: row.key, version: row.version, errors: parsed.errors }, 'Stored flow definition is invalid');
        return null;
    }
    return parsed.definition;
}

/** In-flight conversations stay on their pinned version; everyone else gets the active one. */
async function resolveDefinition(
    deps: FlowRunnerDeps,
    tenant: { id: string; vertical: string; activeFlowKey: string | null },
    state: FlowState | null,
): Promise<FlowDefinition | null> {
    if (state && (state.status === 'active' || state.status === 'waiting')) {
        const pinned = parseStored(deps, await deps.store.findDefinition({
            tenantId: tenant.id, vertical: tenant.vertical, key: state.flowKey, version: state.flowVersion,
        }), tenant.id);
        if (pinned) return pinned;
    }
    return parseStored(deps, await deps.store.findDefinition({
        tenantId: tenant.id, vertical: tenant.vertical, key: tenant.activeFlowKey,
    }), tenant.id);
}

const MAX_ATTEMPTS = 2;

export async function runFlowTurn(deps: FlowRunnerDeps, args: FlowTurnArgs): Promise<FlowTurnResult> {
    const { tenant, inbound } = args;
    let conv = args.conversation;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const state = readFlowState(conv.botContext);
        if (state && state.lastInboundId === inbound.inboundId) {
            return { reply: '', wantsHuman: false, toolsUsed: [] };
        }

        const def = await resolveDefinition(deps, tenant, state);
        if (!def) {
            deps.log?.error({ tenantId: tenant.id, key: tenant.activeFlowKey }, 'No usable flow definition; handing to a human');
            return { reply: '', wantsHuman: true, toolsUsed: ['flow:unavailable'] };
        }

        const meta: FlowMeta = {
            tenantId: tenant.id, conversationId: conv.id, customerPhone: conv.customerPhone,
            currency: tenant.currency ?? deps.defaultCurrency ?? DEFAULT_CURRENCY,
        };
        const result = await step(def, state, inbound, deps.ports, meta);

        const saved = await deps.store.saveBotContext(tenant.id, conv.id, conv.contextVersion, withFlowState(conv.botContext, result.state));
        if (saved) return toResult(result);

        deps.log?.warn({ tenantId: tenant.id, conversationId: conv.id, attempt }, 'Flow state write lost the race');
        const fresh = await deps.store.loadConversation(tenant.id, conv.id);
        if (!fresh) break;
        conv = fresh;
    }

    deps.log?.error({ tenantId: tenant.id, conversationId: conv.id }, 'Flow state write conflicted twice; handing to a human');
    return { reply: FLOW_CONFLICT_REPLY, wantsHuman: true, toolsUsed: ['flow:conflict'] };
}

function toResult(r: StepResult): FlowTurnResult {
    return { reply: r.replies.join('\n\n'), wantsHuman: r.handoff !== null, toolsUsed: toolsUsed(r.effects), completed: r.completed };
}

/**
 * Apply an external event (payment succeeded / failed) to a conversation
 * waiting on it. The caller sends `reply` (if non-empty) and, when
 * `wantsHuman`, takes the conversation off the bot. `applied: false` means the
 * conversation was not waiting on this (or the event was a duplicate): do nothing.
 */
export async function advanceFlow(deps: FlowRunnerDeps, args: AdvanceFlowArgs): Promise<AdvanceFlowResult> {
    const none: AdvanceFlowResult = { applied: false, reply: '', wantsHuman: false };
    let conv = await deps.store.loadConversation(args.tenantId, args.conversationId);

    for (let attempt = 0; conv && attempt < MAX_ATTEMPTS; attempt++) {
        const state = readFlowState(conv.botContext);
        if (!state || state.status !== 'waiting') return none;

        const def = await resolveDefinition(
            deps, { id: args.tenantId, vertical: args.vertical ?? '', activeFlowKey: null }, state,
        );
        if (!def) {
            deps.log?.error({ tenantId: args.tenantId, conversationId: args.conversationId }, 'Waiting flow has no usable definition');
            return { applied: false, reply: '', wantsHuman: true };
        }

        const meta: FlowMeta = {
            tenantId: args.tenantId, conversationId: conv.id, customerPhone: conv.customerPhone,
            currency: args.currency ?? deps.defaultCurrency ?? DEFAULT_CURRENCY,
        };
        const result = await advance(def, state, args.event, deps.ports, meta);
        if (!result.applied) return none;

        const saved = await deps.store.saveBotContext(args.tenantId, conv.id, conv.contextVersion, withFlowState(conv.botContext, result.state));
        if (saved) return { applied: true, ...pickReply(result) };

        conv = await deps.store.loadConversation(args.tenantId, args.conversationId);
    }

    deps.log?.error({ tenantId: args.tenantId, conversationId: args.conversationId }, 'advanceFlow could not save state');
    return { applied: false, reply: FLOW_CONFLICT_REPLY, wantsHuman: true };
}

function pickReply(r: StepResult): { reply: string; wantsHuman: boolean; completed: FlowCompletion | null } {
    return { reply: r.replies.join('\n\n'), wantsHuman: r.handoff !== null, completed: r.completed };
}
