/**
 * The flow engine: step(definition, state, input, ports, meta).
 *
 * Deterministic and scripted — no LLM. It never touches the database or the
 * network itself: payment links, staff queues and pack actions go through the
 * injected `ports`, and the caller persists the returned state. The input
 * state is never mutated.
 *
 * One call may run several steps: after an answer is accepted, automatic steps
 * (notify, branch, action, staff, payment, end) run until the flow reaches a
 * step that needs the customer again, collecting every reply on the way.
 *
 * A WAITING PAYMENT STEP. Once the payment link is sent the flow waits there.
 * Whatever the customer types is answered with the step's `waitingText`; it
 * never counts as a miss and never moves the flow. Every third such message
 * also reminds them of the flow's global "menu" command (if the flow defines
 * one), which is the way out of the step (it restarts at the menu and the old
 * link stops advancing anything: see below). The flow moves on only by an
 * external payment event (`advance`) that is for THIS link: its reference must
 * equal the one recorded on the step, and what was paid must cover the step's
 * amount in the step's currency, so an old cheaper link cannot pay for a newer,
 * dearer one that happens to sit at the same step.
 *
 * Side effects carry an idempotency key (`conversationId:inboundOrEventId:state`)
 * so the real ports can de-duplicate if the caller replays a turn.
 */
import {
    type FlowDefinition, type FlowState, type FlowStep, type MenuStep, type ChooseStep,
    type LocationStep, type AskStep, type ConfirmStep, type PaymentStep, type BranchStep,
} from './types.js';
import { renderTemplate } from './template.js';
import { validateField } from './validators.js';

export const MAX_CONSECUTIVE_MISSES = 3;
export const MAX_AUTO_HOPS = 30;

export const DEFAULT_INVALID_TEXT = "Sorry, I didn't get that.";
export const DEFAULT_HANDOFF_TEXT = "Let me get someone from the team to help you. They'll reply shortly.";
export const DEFAULT_WAITING_TEXT = "We're still waiting for your payment to come through. We'll message you as soon as it does.";
/** While waiting on a payment, every Nth chatter message also mentions the global menu command. */
export const WAITING_REMINDER_EVERY = 3;
export const MENU_REMINDER_TEXT = "Reply \"menu\" if you'd like to start over.";
export const DEFAULT_PAYMENT_FAILED_TEXT = "Sorry, we couldn't set up the payment just now.";

// ---------------------------------------------------------------- contracts

export interface FlowInput {
    /** Provider message id: the idempotency key for the turn. */
    inboundId: string;
    text?: string;
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    /** Id of a tapped WhatsApp button / list row. */
    interactiveId?: string;
}

export interface FlowMeta {
    tenantId: string;
    conversationId: string;
    customerPhone: string | null;
    currency: string;
}

export interface PaymentLinkRequest {
    tenantId: string;
    conversationId: string;
    customerPhone: string | null;
    kind: string;
    /** Major unit. */
    amount: number;
    currency: string;
    vars: Record<string, string>;
    idempotencyKey: string;
}

export interface StaffRequest {
    tenantId: string;
    conversationId: string;
    queue: string | null;
    handoff: boolean;
    vars: Record<string, string>;
    idempotencyKey: string;
}

export interface ActionRequest {
    tenantId: string;
    conversationId: string;
    customerPhone: string | null;
    name: string;
    args: Record<string, string>;
    vars: Record<string, string>;
    idempotencyKey: string;
}

export interface ActionResult {
    ok: boolean;
    /** Only variables the step lists in `produces` are kept. */
    vars?: Record<string, string | number | boolean>;
    /** Extra text for the customer. */
    reply?: string;
}

export interface FlowPorts {
    /** null = could not create a link. May throw; both are treated as failure. */
    createPaymentLink(req: PaymentLinkRequest): Promise<{ url: string; reference?: string } | null>;
    /** Place the conversation in a staff queue. Throwing is handled (alert + handoff). */
    enqueueStaff(req: StaffRequest): Promise<void>;
    runAction(req: ActionRequest): Promise<ActionResult>;
}

export type FlowEffect =
    | { type: 'payment_link_created'; kind: string; amount: number; reference: string | null }
    | { type: 'payment_link_failed'; kind: string }
    | { type: 'staff_queued'; queue: string | null }
    | { type: 'staff_queue_failed'; queue: string | null }
    | { type: 'action_ran'; name: string; ok: boolean }
    | { type: 'handoff'; reason: string };

export interface StepResult {
    replies: string[];
    state: FlowState;
    effects: FlowEffect[];
    handoff: { reason: string } | null;
    /** Set when this call took the flow to its end. */
    completed: FlowCompletion | null;
}

export interface FlowEvent {
    type: 'payment.succeeded' | 'payment.failed';
    /** De-duplicates redelivered events. */
    eventId?: string;
    /** Fulfillment kind; when given it must match the waiting payment step. */
    kind?: string;
    /** Only keys the payment step lists in `produces` are accepted. */
    vars?: Record<string, string>;
    /**
     * The payment reference this event is for. When the waiting step recorded a
     * link reference, the event must carry the SAME one: a stale link (an
     * earlier, cheaper choice) cannot advance the current step.
     */
    reference?: string;
    /** What the provider says was paid (minor units); checked against the CURRENT step's amount. */
    amountMinor?: number;
    /** Currency of that payment; must equal the current step's. */
    currency?: string;
}

/** Reported when a run reaches the end of the flow. */
export interface FlowCompletion {
    flowKey: string;
    version: number;
    /** Only variables safe to hand to subscribers (see shareableVars). */
    vars: Record<string, string>;
}

export interface AdvanceResult extends StepResult {
    applied: boolean;
}

export function newFlowState(def: FlowDefinition): FlowState {
    return {
        flowKey: def.key,
        flowVersion: def.version,
        current: def.start,
        status: 'active',
        vars: {},
        misses: 0,
        lastInboundId: null,
        lastEventId: null,
    };
}

// ------------------------------------------------------------------ helpers

type Accepted = { ok: true; vars: Record<string, string>; next: string } | { ok: false };
const REJECT: Accepted = { ok: false };

function selectIndex(count: number, ids: (string | undefined)[], labels: string[], input: FlowInput): number | null {
    if (input.interactiveId) {
        const i = ids.findIndex((id, idx) => (id ?? String(idx + 1)) === input.interactiveId);
        return i >= 0 ? i : null;
    }
    const text = (input.text ?? '').trim().toLowerCase();
    if (!text) return null;
    if (/^\d{1,3}$/.test(text)) {
        const n = Number(text);
        return n >= 1 && n <= count ? n - 1 : null;
    }
    const i = labels.findIndex((l) => l.toLowerCase() === text);
    return i >= 0 ? i : null;
}

function numberedList(labels: string[]): string {
    return labels.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

function parseAmount(raw: string | undefined): number | null {
    if (raw === undefined || !/^\d+(\.\d{1,2})?$/.test(raw.trim())) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function evalBranch(step: BranchStep, vars: Record<string, string>): string {
    for (const c of step.cases) {
        const actual = vars[c.when.var];
        const expected = c.when.value;
        let hit = false;
        switch (c.when.op) {
            case 'exists': hit = actual !== undefined && actual !== ''; break;
            case 'eq': hit = actual === expected; break;
            case 'neq': hit = actual !== expected; break;
            default: {
                const a = actual === undefined || actual === '' ? NaN : Number(actual);
                const b = expected === undefined ? NaN : Number(expected);
                if (Number.isFinite(a) && Number.isFinite(b)) {
                    hit = c.when.op === 'gt' ? a > b : c.when.op === 'gte' ? a >= b : c.when.op === 'lt' ? a < b : a <= b;
                }
            }
        }
        if (hit) return c.next;
    }
    return step.default;
}

/**
 * The variables a completed flow may expose in its `flow.completed` event.
 * An ALLOWLIST built from the definition: values the customer chose from fixed
 * lists (menu `set`, choose value/label/attrs) and values a step declares it
 * `produces`. Free-text answers (ask: names, emails, phones, ids), locations,
 * the payment link and reference, and the customer's phone are never included.
 */
export function shareableVars(def: FlowDefinition, vars: Record<string, string>): Record<string, string> {
    const allowed = new Set<string>();
    for (const st of Object.values(def.states)) {
        if (st.type === 'menu') for (const o of st.options) for (const k of Object.keys(o.set ?? {})) allowed.add(k);
        else if (st.type === 'choose') {
            allowed.add(st.var);
            allowed.add(`${st.var}_label`);
            for (const it of st.items) for (const a of Object.keys(it.attrs ?? {})) allowed.add(`${st.var}_${a}`);
        } else if (st.type === 'action' || st.type === 'payment') for (const k of st.produces ?? []) allowed.add(k);
    }
    const out: Record<string, string> = {};
    for (const k of Object.keys(vars)) if (allowed.has(k) && typeof vars[k] === 'string') out[k] = vars[k];
    return out;
}

/** Same one-minor-unit tolerance as the payment fulfillers. */
const AMOUNT_TOLERANCE_MINOR = 1;

const YES = new Set(['1', 'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'confirm']);
const NO = new Set(['2', 'n', 'no', 'nope', 'cancel']);

// --------------------------------------------------------------------- Run

class Run {
    replies: string[] = [];
    effects: FlowEffect[] = [];
    handoff: { reason: string } | null = null;
    completed: FlowCompletion | null = null;
    private hops = 0;

    constructor(
        private readonly def: FlowDefinition,
        public s: FlowState,
        private readonly ports: FlowPorts,
        private readonly meta: FlowMeta,
        private readonly trigger: string,
    ) {}

    private render(text: string): string {
        return renderTemplate(text, { ...this.s.vars, customer_phone: this.meta.customerPhone ?? '' });
    }

    private key(state: string): string {
        return `${this.meta.conversationId}:${this.trigger}:${state}`;
    }

    private setVars(vars: Record<string, string>): void {
        this.s = { ...this.s, vars: { ...this.s.vars, ...vars } };
    }

    private patch(p: Partial<FlowState>): void {
        this.s = { ...this.s, ...p };
    }

    private complete(): void {
        this.patch({ status: 'ended' });
        this.completed = { flowKey: this.def.key, version: this.def.version, vars: shareableVars(this.def, this.s.vars) };
    }

    private doHandoff(reason: string): void {
        this.handoff = { reason };
        this.effects.push({ type: 'handoff', reason });
        this.patch({ status: 'handed_off' });
    }

    prompt(step: FlowStep): string {
        switch (step.type) {
            case 'menu': return this.render(`${step.prompt}\n\n${numberedList(step.options.map((o) => o.label))}`);
            case 'choose': return this.render(`${step.prompt}\n\n${numberedList(step.items.map((o) => o.label))}`);
            case 'location': return this.render(step.fallback?.length
                ? `${step.prompt}\n\nOr reply with a number:\n${numberedList(step.fallback.map((f) => f.label))}`
                : step.prompt);
            case 'confirm': return this.render(`${step.prompt}\n\n1. Yes\n2. No`);
            case 'ask': return this.render(step.prompt);
            default: return '';
        }
    }

    /** Run from `name` until a step needs the customer, waits, ends or hands off. */
    async enter(first: string): Promise<void> {
        let name = first;
        for (;;) {
            if (++this.hops > MAX_AUTO_HOPS) return this.doHandoff('flow_loop');
            const step = this.def.states[name];
            if (!step) return this.doHandoff('unknown_state');
            this.patch({ current: name, status: 'active', misses: this.s.misses });

            switch (step.type) {
                case 'menu': case 'choose': case 'location': case 'confirm': case 'ask':
                    this.replies.push(this.prompt(step));
                    return;
                case 'notify':
                    this.replies.push(this.render(step.text));
                    name = step.next;
                    break;
                case 'branch':
                    name = evalBranch(step, this.s.vars);
                    break;
                case 'end':
                    if (step.text) this.replies.push(this.render(step.text));
                    this.complete();
                    return;
                case 'staff': {
                    if (step.text) this.replies.push(this.render(step.text));
                    const queue = step.queue ?? null;
                    try {
                        await this.ports.enqueueStaff({
                            tenantId: this.meta.tenantId, conversationId: this.meta.conversationId, queue,
                            handoff: step.handoff === true, vars: { ...this.s.vars }, idempotencyKey: this.key(name),
                        });
                        this.effects.push({ type: 'staff_queued', queue });
                    } catch {
                        this.effects.push({ type: 'staff_queue_failed', queue });
                        // A person must see this even if the queue is down.
                        return this.doHandoff('staff_queue_failed');
                    }
                    if (step.handoff) return this.doHandoff('staff');
                    if (!step.next) { this.complete(); return; }
                    name = step.next;
                    break;
                }
                case 'action': {
                    const next = await this.runAction(name, step);
                    if (next === null) return;
                    name = next;
                    break;
                }
                case 'payment': {
                    const next = await this.startPayment(name, step);
                    if (next === null) return;
                    name = next;
                    break;
                }
            }
        }
    }

    private async runAction(stateName: string, step: Extract<FlowStep, { type: 'action' }>): Promise<string | null> {
        const args: Record<string, string> = {};
        for (const [k, v] of Object.entries(step.args ?? {})) args[k] = this.render(v);
        let result: ActionResult;
        try {
            result = await this.ports.runAction({
                tenantId: this.meta.tenantId, conversationId: this.meta.conversationId,
                customerPhone: this.meta.customerPhone, name: step.action, args,
                vars: { ...this.s.vars }, idempotencyKey: this.key(stateName),
            });
        } catch {
            result = { ok: false };
        }
        this.effects.push({ type: 'action_ran', name: step.action, ok: result.ok });
        if (!result.ok) {
            if (step.onError) return step.onError;
            this.doHandoff('action_failed');
            return null;
        }
        const allowed = new Set(step.produces ?? []);
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.vars ?? {})) if (allowed.has(k)) vars[k] = String(v);
        this.setVars(vars);
        if (result.reply) this.replies.push(result.reply);
        return step.next;
    }

    /** Returns the next state to run, or null when the flow now waits / hands off. */
    private async startPayment(stateName: string, step: PaymentStep): Promise<string | null> {
        const amount = step.amount ?? parseAmount(step.amountVar ? this.s.vars[step.amountVar] : undefined);
        let link: { url: string; reference?: string } | null = null;
        if (amount !== null && amount > 0) {
            try {
                link = await this.ports.createPaymentLink({
                    tenantId: this.meta.tenantId, conversationId: this.meta.conversationId,
                    customerPhone: this.meta.customerPhone, kind: step.kind, amount,
                    currency: step.currency ?? this.meta.currency, vars: { ...this.s.vars },
                    idempotencyKey: this.key(stateName),
                });
            } catch {
                link = null;
            }
        }
        if (!link || !link.url) {
            this.effects.push({ type: 'payment_link_failed', kind: step.kind });
            this.replies.push(this.render(step.failureText ?? DEFAULT_PAYMENT_FAILED_TEXT));
            if (step.onFailure) return step.onFailure;
            this.doHandoff('payment_link_failed');
            return null;
        }
        this.effects.push({ type: 'payment_link_created', kind: step.kind, amount: amount as number, reference: link.reference ?? null });
        this.setVars({ payment_url: link.url, payment_reference: link.reference ?? '' });
        this.patch({ waitingMessages: 0 });
        this.replies.push(this.render(step.prompt));
        this.patch({ status: 'waiting' });
        return null;
    }

    // ---- accepting an answer

    private accept(step: FlowStep, input: FlowInput): Accepted {
        switch (step.type) {
            case 'menu': return this.acceptMenu(step, input);
            case 'ask': return this.acceptAsk(step, input);
            case 'location': return this.acceptLocation(step, input);
            case 'choose': return this.acceptChoose(step, input);
            case 'confirm': return this.acceptConfirm(step, input);
            default: return REJECT;
        }
    }

    private acceptMenu(step: MenuStep, input: FlowInput): Accepted {
        const i = selectIndex(step.options.length, step.options.map((o) => o.id), step.options.map((o) => o.label), input);
        if (i === null) return REJECT;
        const o = step.options[i];
        return { ok: true, vars: { ...(o.set ?? {}) }, next: o.next };
    }

    private acceptAsk(step: AskStep, input: FlowInput): Accepted {
        if (typeof input.text !== 'string') return REJECT;
        const r = validateField({ validate: step.validate, pattern: step.pattern }, input.text);
        return r.ok ? { ok: true, vars: { [step.var]: r.value }, next: step.next } : REJECT;
    }

    private acceptLocation(step: LocationStep, input: FlowInput): Accepted {
        const loc = input.location;
        if (loc) {
            const { latitude: lat, longitude: lng } = loc;
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return REJECT;
            const label = (loc.name || loc.address || `${lat},${lng}`).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
            return this.locationVars(step, lat, lng, label);
        }
        const fb = step.fallback;
        if (fb && fb.length > 0 && !input.interactiveId) {
            const i = selectIndex(fb.length, [], fb.map((f) => f.label), input);
            if (i !== null) return this.locationVars(step, fb[i].latitude, fb[i].longitude, fb[i].label);
        }
        return REJECT;
    }

    private locationVars(step: LocationStep, lat: number, lng: number, label: string): Accepted {
        return {
            ok: true, next: step.next,
            vars: { [step.var]: label, [`${step.var}_label`]: label, [`${step.var}_lat`]: String(lat), [`${step.var}_lng`]: String(lng) },
        };
    }

    private acceptChoose(step: ChooseStep, input: FlowInput): Accepted {
        const i = selectIndex(step.items.length, step.items.map((x) => x.value), step.items.map((x) => x.label), input);
        if (i === null) return REJECT;
        const item = step.items[i];
        const vars: Record<string, string> = { [step.var]: item.value, [`${step.var}_label`]: item.label };
        for (const [k, v] of Object.entries(item.attrs ?? {})) vars[`${step.var}_${k}`] = String(v);
        return { ok: true, vars, next: step.next };
    }

    private acceptConfirm(step: ConfirmStep, input: FlowInput): Accepted {
        const t = (input.interactiveId ?? input.text ?? '').trim().toLowerCase();
        if (YES.has(t)) return { ok: true, vars: {}, next: step.yes };
        if (NO.has(t)) return { ok: true, vars: {}, next: step.no };
        return REJECT;
    }

    /** Handle one customer message against the current (interactive) step. */
    async handleInput(input: FlowInput): Promise<void> {
        const step = this.def.states[this.s.current];
        const typed = (input.text ?? '').trim().toLowerCase();

        const global = !input.interactiveId && typed ? this.def.globals?.[typed] : undefined;
        if (global) {
            this.patch({ misses: 0 });
            return this.enter(global.goto);
        }

        if (this.s.status === 'waiting' && step.type === 'payment') {
            const waited = (this.s.waitingMessages ?? 0) + 1;
            this.patch({ waitingMessages: waited });
            const waiting = this.render(step.waitingText ?? DEFAULT_WAITING_TEXT);
            // No state change: only a nudge towards the way out, and only if the flow has one.
            const nudge = waited % WAITING_REMINDER_EVERY === 0 && this.def.globals?.menu;
            this.replies.push(nudge ? `${waiting}\n\n${MENU_REMINDER_TEXT}` : waiting);
            return;
        }

        const accepted = this.accept(step, input);
        if (accepted.ok) {
            this.setVars(accepted.vars);
            this.patch({ misses: 0 });
            return this.enter(accepted.next);
        }

        const misses = this.s.misses + 1;
        this.patch({ misses });
        if (misses >= MAX_CONSECUTIVE_MISSES) {
            this.replies.push(this.def.handoffText ?? DEFAULT_HANDOFF_TEXT);
            return this.doHandoff('too_many_misses');
        }
        const invalid = ('invalid' in step && step.invalid) || this.def.invalidText || DEFAULT_INVALID_TEXT;
        this.replies.push(`${this.render(invalid)}\n\n${this.prompt(step)}`);
    }

    /** Move a waiting payment step forward on an external event. */
    async handleEvent(event: FlowEvent, step: PaymentStep): Promise<void> {
        const allowed = new Set(step.produces ?? []);
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(event.vars ?? {})) if (allowed.has(k) && typeof v === 'string') vars[k] = v;
        this.setVars(vars);
        this.patch({ misses: 0, waitingMessages: 0, lastEventId: event.eventId ?? this.s.lastEventId ?? null });
        if (event.type === 'payment.succeeded') return this.enter(step.onSuccess);
        if (step.onFailure) return this.enter(step.onFailure);
        this.replies.push(this.render(step.failureText ?? DEFAULT_PAYMENT_FAILED_TEXT));
        this.doHandoff('payment_failed');
    }

    result(): StepResult {
        return { replies: this.replies, state: this.s, effects: this.effects, handoff: this.handoff, completed: this.completed };
    }
}

// --------------------------------------------------------------- public API

function needsRestart(def: FlowDefinition, state: FlowState): boolean {
    return state.status === 'ended'
        || state.status === 'handed_off'
        || state.flowKey !== def.key
        || state.flowVersion !== def.version
        || !def.states[state.current];
}

/**
 * Process one inbound customer message. Returns the replies to send and the
 * new state to persist. A replayed `inboundId` returns no replies and the
 * unchanged state.
 */
export async function step(
    def: FlowDefinition,
    state: FlowState | null,
    input: FlowInput,
    ports: FlowPorts,
    meta: FlowMeta,
): Promise<StepResult> {
    if (state && state.lastInboundId === input.inboundId) {
        return { replies: [], state, effects: [], handoff: null, completed: null };
    }

    if (!state || needsRestart(def, state)) {
        // First contact (or a finished flow): show the start state. The message
        // that opened the conversation is not interpreted as an answer.
        const run = new Run(def, { ...newFlowState(def), lastInboundId: input.inboundId }, ports, meta, input.inboundId);
        await run.enter(def.start);
        return run.result();
    }

    const run = new Run(def, { ...state, vars: { ...state.vars }, lastInboundId: input.inboundId }, ports, meta, input.inboundId);
    await run.handleInput(input);
    return run.result();
}

/**
 * Does the event belong to the payment the flow is waiting on right now?
 *  - reference: when the step recorded its link's reference, the event's must equal it.
 *  - amount/currency (succeeded only): what was paid must cover the CURRENT step's
 *    amount, in the step's currency. Checked even when no reference was recorded.
 * Fields the caller does not supply are not checked.
 */
function eventIsForThisPayment(event: FlowEvent, current: PaymentStep, state: FlowState, meta: FlowMeta): boolean {
    const held = state.vars.payment_reference;
    if (event.reference !== undefined && held && held !== event.reference) return false;
    if (event.type !== 'payment.succeeded') return true;
    const askedMajor = current.amount ?? parseAmount(current.amountVar ? state.vars[current.amountVar] : undefined);
    if (event.currency !== undefined && event.currency.toUpperCase() !== (current.currency ?? meta.currency).toUpperCase()) return false;
    if (event.amountMinor !== undefined) {
        // An amount that cannot be determined is a mismatch, not a pass: money
        // with nothing to compare it to must not buy the success branch (it
        // takes the unmatched-money path and a person is alerted instead).
        if (askedMajor === null) return false;
        if (event.amountMinor < Math.round(askedMajor * 100) - AMOUNT_TOLERANCE_MINOR) return false;
    }
    return true;
}

/**
 * Advance a flow waiting on a payment because of an external event. Ignored
 * (applied: false) when the flow is not waiting on a matching payment step or
 * the event id was already applied.
 */
export async function advance(
    def: FlowDefinition,
    state: FlowState | null,
    event: FlowEvent,
    ports: FlowPorts,
    meta: FlowMeta,
): Promise<AdvanceResult> {
    const ignored = (s: FlowState): AdvanceResult => ({ replies: [], state: s, effects: [], handoff: null, completed: null, applied: false });
    if (!state) return ignored(newFlowState(def));
    if (state.status !== 'waiting' || state.flowKey !== def.key || state.flowVersion !== def.version) return ignored(state);
    const current = def.states[state.current];
    if (!current || current.type !== 'payment') return ignored(state);
    if (event.kind !== undefined && event.kind !== current.kind) return ignored(state);
    if (event.eventId !== undefined && state.lastEventId === event.eventId) return ignored(state);
    if (!eventIsForThisPayment(event, current, state, meta)) return ignored(state);

    const run = new Run(def, { ...state, vars: { ...state.vars } }, ports, meta, event.eventId ?? event.type);
    await run.handleEvent(event, current);
    return { ...run.result(), applied: true };
}
