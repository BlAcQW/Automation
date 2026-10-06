/**
 * Flow definition format (zod) and the persisted per-conversation state.
 *
 * A flow is plain data: { key, version, start, states }. Each state is one
 * step from a fixed catalogue; the engine (engine.ts) interprets it. Nothing
 * here is executable, so a definition can be authored, stored and published
 * by a tenant admin without being a code-execution risk.
 */
import { z } from 'zod';

export const STATE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
export const VAR_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ATTR_NAME = /^[a-z][a-z0-9_]{0,29}$/;

/** Written by the engine or supplied from the conversation; a definition may not define them. */
export const RESERVED_VARS = ['customer_phone', 'payment_url', 'payment_reference'] as const;
/** Readable in copy without being defined by any step. */
export const BUILTIN_VARS = ['customer_phone'] as const;

const stateName = z.string().regex(STATE_NAME, 'state names are a-z, 0-9, _ and start with a letter');
const varName = z
    .string()
    .regex(VAR_NAME, 'variable names are a-z, 0-9, _ and start with a letter')
    .refine((v) => !(RESERVED_VARS as readonly string[]).includes(v), 'reserved variable name');
const text = z.string().min(1).max(1000);
const invalid = z.string().min(1).max(500).optional();

const menuStep = z.object({
    type: z.literal('menu'),
    prompt: text,
    invalid,
    options: z
        .array(z.object({
            id: z.string().min(1).max(100).optional(),
            label: z.string().min(1).max(60),
            next: stateName,
            set: z.record(varName, z.string().max(200)).optional(),
        }).strict())
        .min(1)
        .max(10),
}).strict();

const askStep = z.object({
    type: z.literal('ask'),
    prompt: text,
    invalid,
    validate: z.enum(['name', 'email', 'phone', 'studentId', 'free']),
    /** studentId only: override the default pattern. */
    pattern: z.string().min(1).max(100).optional(),
    var: varName,
    next: stateName,
}).strict();

const locationStep = z.object({
    type: z.literal('location'),
    prompt: text,
    invalid,
    var: varName,
    fallback: z
        .array(z.object({
            label: z.string().min(1).max(60),
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
        }).strict())
        .max(10)
        .optional(),
    next: stateName,
}).strict();

const chooseStep = z.object({
    type: z.literal('choose'),
    prompt: text,
    invalid,
    var: varName,
    items: z
        .array(z.object({
            label: z.string().min(1).max(60),
            value: z.string().min(1).max(100),
            attrs: z.record(z.string().regex(ATTR_NAME), z.union([z.string().max(200), z.number()])).optional(),
        }).strict())
        .min(1)
        .max(30),
    next: stateName,
}).strict();

const confirmStep = z.object({
    type: z.literal('confirm'),
    prompt: text,
    invalid,
    yes: stateName,
    no: stateName,
}).strict();

const paymentStep = z.object({
    type: z.literal('payment'),
    /** Must contain {payment_url}. */
    prompt: text,
    kind: z.string().min(1).max(40),
    amount: z.number().positive().finite().optional(),
    amountVar: varName.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    waitingText: z.string().min(1).max(500).optional(),
    failureText: z.string().min(1).max(500).optional(),
    /** Variables an external event may set when it advances this step. */
    produces: z.array(varName).max(10).optional(),
    onSuccess: stateName,
    onFailure: stateName.optional(),
}).strict();

const notifyStep = z.object({ type: z.literal('notify'), text, next: stateName }).strict();

const staffStep = z.object({
    type: z.literal('staff'),
    text: z.string().min(1).max(1000).optional(),
    queue: z.string().min(1).max(40).optional(),
    /** True: the conversation leaves the bot for a human. False: queue it and carry on. */
    handoff: z.boolean().optional(),
    next: stateName.optional(),
}).strict();

const actionStep = z.object({
    type: z.literal('action'),
    action: z.string().min(1).max(60),
    args: z.record(z.string().regex(ATTR_NAME), z.string().max(500)).optional(),
    /** Variables the action may set; anything else it returns is dropped. */
    produces: z.array(varName).max(10).optional(),
    next: stateName,
    onError: stateName.optional(),
}).strict();

export const BRANCH_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
const branchStep = z.object({
    type: z.literal('branch'),
    cases: z
        .array(z.object({
            when: z.object({
                var: z.string().regex(VAR_NAME),
                op: z.enum(BRANCH_OPS),
                value: z.string().max(200).optional(),
            }).strict(),
            next: stateName,
        }).strict())
        .min(1)
        .max(20),
    default: stateName,
}).strict();

const endStep = z.object({ type: z.literal('end'), text: z.string().min(1).max(1000).optional() }).strict();

export const stepSchema = z.discriminatedUnion('type', [
    menuStep, askStep, locationStep, chooseStep, confirmStep,
    paymentStep, notifyStep, staffStep, actionStep, branchStep, endStep,
]);

export const flowDefinitionSchema = z.object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
    version: z.number().int().min(1),
    start: stateName,
    /** Typed command (case-insensitive, trimmed) -> jump. Checked before the current step. */
    globals: z.record(z.string().regex(/^[a-z][a-z0-9]{0,19}$/), z.object({ goto: stateName }).strict()).optional(),
    /** Shown on handoff after repeated misses. */
    handoffText: z.string().min(1).max(500).optional(),
    invalidText: z.string().min(1).max(500).optional(),
    states: z.record(stateName, stepSchema).refine((s) => Object.keys(s).length >= 1 && Object.keys(s).length <= 200, 'between 1 and 200 states'),
}).strict();

export type FlowStep = z.infer<typeof stepSchema>;
export type FlowStepType = FlowStep['type'];
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type MenuStep = z.infer<typeof menuStep>;
export type AskStep = z.infer<typeof askStep>;
export type LocationStep = z.infer<typeof locationStep>;
export type ChooseStep = z.infer<typeof chooseStep>;
export type ConfirmStep = z.infer<typeof confirmStep>;
export type PaymentStep = z.infer<typeof paymentStep>;
export type NotifyStep = z.infer<typeof notifyStep>;
export type StaffStep = z.infer<typeof staffStep>;
export type ActionStep = z.infer<typeof actionStep>;
export type BranchStep = z.infer<typeof branchStep>;
export type EndStep = z.infer<typeof endStep>;

export const flowStateSchema = z.object({
    flowKey: z.string(),
    flowVersion: z.number().int(),
    current: z.string(),
    status: z.enum(['active', 'waiting', 'ended', 'handed_off']),
    vars: z.record(z.string(), z.string()),
    misses: z.number().int().min(0),
    lastInboundId: z.string().nullable(),
    lastEventId: z.string().nullable().optional(),
    /** Customer messages received while waiting on a payment (drives the menu reminder). */
    waitingMessages: z.number().int().min(0).optional(),
});

/** Persisted under Conversation.botContext.flow. */
export type FlowState = z.infer<typeof flowStateSchema>;
