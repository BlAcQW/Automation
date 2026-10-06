/**
 * Registry of pack actions a flow's `action` step may call by name.
 *
 * Packs (e.g. TURBO) register actions at boot; a definition naming an
 * unregistered action fails validation, so a typo can never reach a customer.
 */
import type { ActionRequest, ActionResult } from './engine.js';

export type FlowActionFn = (req: ActionRequest) => Promise<ActionResult>;

/** Names the platform keeps for itself. The `bookly.` prefix is reserved too. */
export const RESERVED_FLOW_ACTIONS = ['handoff', 'end', 'noop', 'payment', 'staff', 'notify', 'branch'] as const;

const NAME_PATTERN = /^[a-z][a-z0-9_.]{1,59}$/;
const actions = new Map<string, FlowActionFn>();

export function isReservedFlowAction(name: string): boolean {
    return (RESERVED_FLOW_ACTIONS as readonly string[]).includes(name) || name.startsWith('bookly.');
}

export function registerFlowAction(name: string, fn: FlowActionFn): void {
    if (isReservedFlowAction(name)) throw new Error(`Flow action "${name}" is reserved and cannot be registered`);
    if (!NAME_PATTERN.test(name)) throw new Error(`Invalid flow action name "${name}": use 2-60 chars of a-z, 0-9, _ and . starting with a letter`);
    if (actions.has(name)) throw new Error(`A flow action is already registered as "${name}"`);
    actions.set(name, fn);
}

export function isRegisteredFlowAction(name: string): boolean {
    return actions.has(name);
}

export function getFlowAction(name: string): FlowActionFn | undefined {
    return actions.get(name);
}

export function resetFlowActionsForTests(): void {
    actions.clear();
}

/** Default `FlowPorts.runAction`: dispatch to the registry. */
export async function runRegisteredAction(req: ActionRequest): Promise<ActionResult> {
    const fn = actions.get(req.name);
    if (!fn) return { ok: false };
    return fn(req);
}
