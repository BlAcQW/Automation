/**
 * Definition validation: schema (zod) plus the cross-references the schema
 * cannot express — state names, variables used in copy, registered actions
 * and payment kinds.
 */
import { flowDefinitionSchema, BUILTIN_VARS, type FlowDefinition, type FlowStep } from './types.js';
import { templateVars } from './template.js';
import { isRegisteredFlowAction } from './actions.js';
import { isRegisteredFulfillmentKind } from '../payment-fulfillers.js';
import { isSafePattern } from './validators.js';

export type ParseResult = { ok: true; definition: FlowDefinition } | { ok: false; errors: string[] };

export interface ValidateOptions {
    /** Refuse payment kinds with no registered fulfiller (default true). */
    checkPaymentKinds?: boolean;
}

/** Every state a step can move to. */
export function transitionsOf(step: FlowStep): string[] {
    switch (step.type) {
        case 'menu': return step.options.map((o) => o.next);
        case 'ask': case 'location': case 'choose': case 'notify': return [step.next];
        case 'confirm': return [step.yes, step.no];
        case 'payment': return [step.onSuccess, ...(step.onFailure ? [step.onFailure] : [])];
        case 'staff': return step.next ? [step.next] : [];
        case 'action': return [step.next, ...(step.onError ? [step.onError] : [])];
        case 'branch': return [...step.cases.map((c) => c.next), step.default];
        case 'end': return [];
    }
}

/** Customer-visible strings (and action args) that may contain {variables}. */
function templatesOf(step: FlowStep): string[] {
    switch (step.type) {
        case 'menu': return [step.prompt, step.invalid ?? '', ...step.options.map((o) => o.label)];
        case 'ask': case 'location': case 'confirm': return [step.prompt, step.invalid ?? ''];
        case 'choose': return [step.prompt, step.invalid ?? '', ...step.items.map((i) => i.label)];
        case 'payment': return [step.prompt, step.waitingText ?? '', step.failureText ?? ''];
        case 'notify': return [step.text];
        case 'staff': case 'end': return [step.text ?? ''];
        case 'action': return Object.values(step.args ?? {});
        case 'branch': return [];
    }
}

/** Variables a step can leave in the conversation state. */
function definedVarsOf(step: FlowStep): string[] {
    switch (step.type) {
        case 'menu': return step.options.flatMap((o) => Object.keys(o.set ?? {}));
        case 'ask': return [step.var];
        case 'location': return [step.var, `${step.var}_lat`, `${step.var}_lng`, `${step.var}_label`];
        case 'choose': {
            const attrs = new Set(step.items.flatMap((i) => Object.keys(i.attrs ?? {})));
            return [step.var, `${step.var}_label`, ...[...attrs].map((a) => `${step.var}_${a}`)];
        }
        case 'payment': return ['payment_url', 'payment_reference', ...(step.produces ?? [])];
        case 'action': return step.produces ?? [];
        default: return [];
    }
}

export function validateFlowDefinition(def: FlowDefinition, opts: ValidateOptions = {}): string[] {
    const errors: string[] = [];
    const checkKinds = opts.checkPaymentKinds ?? true;
    const names = new Set(Object.keys(def.states));

    if (!names.has(def.start)) errors.push(`start state "${def.start}" does not exist`);
    for (const [cmd, g] of Object.entries(def.globals ?? {})) {
        if (!names.has(g.goto)) errors.push(`global "${cmd}" goes to unknown state "${g.goto}"`);
    }

    const known = new Set<string>(BUILTIN_VARS);
    for (const step of Object.values(def.states)) for (const v of definedVarsOf(step)) known.add(v);

    for (const [name, step] of Object.entries(def.states)) {
        for (const target of transitionsOf(step)) {
            if (!names.has(target)) errors.push(`state "${name}" goes to unknown state "${target}"`);
        }
        for (const t of templatesOf(step)) {
            for (const v of templateVars(t)) {
                if (!known.has(v)) errors.push(`state "${name}" uses unknown variable {${v}}`);
            }
        }
        if (step.type === 'ask' && step.pattern !== undefined) {
            if (step.validate !== 'studentId') errors.push(`state "${name}": pattern only applies to validate "studentId"`);
            else if (!isSafePattern(step.pattern)) errors.push(`state "${name}": pattern is invalid or unsafe`);
        }
        if (step.type === 'action' && !isRegisteredFlowAction(step.action)) {
            errors.push(`state "${name}" calls unregistered action "${step.action}"`);
        }
        if (step.type === 'branch') {
            for (const c of step.cases) {
                if (c.when.op !== 'exists' && c.when.value === undefined) errors.push(`state "${name}": branch op "${c.when.op}" needs a value`);
                if (!known.has(c.when.var)) errors.push(`state "${name}" branches on unknown variable "${c.when.var}"`);
            }
        }
        if (step.type === 'payment') {
            if ((step.amount === undefined) === (step.amountVar === undefined)) {
                errors.push(`state "${name}": set exactly one of amount / amountVar`);
            }
            if (step.amountVar && !known.has(step.amountVar)) errors.push(`state "${name}" amountVar "${step.amountVar}" is never set`);
            if (!templateVars(step.prompt).includes('payment_url')) errors.push(`state "${name}": prompt must include {payment_url}`);
            if (checkKinds && !isRegisteredFulfillmentKind(step.kind)) {
                errors.push(`state "${name}": payment kind "${step.kind}" has no registered fulfiller`);
            }
        }
    }
    return errors;
}

export function parseFlowDefinition(raw: unknown, opts: ValidateOptions = {}): ParseResult {
    const parsed = flowDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    const errors = validateFlowDefinition(parsed.data, opts);
    return errors.length > 0 ? { ok: false, errors } : { ok: true, definition: parsed.data };
}
