/**
 * Decision logic for the Prisma tenant guard (see plugins/prisma.ts).
 *
 * Kept free of Prisma and Fastify imports so it is a pure, table-testable
 * function. prisma.ts supplies the model set and acts on the decision.
 *
 * Mode (env TENANT_GUARD_MODE):
 *   block (default) - an unscoped guarded query in tenant context throws
 *                     TenantGuardError (surfaces as a generic 500).
 *   warn            - log `cross_tenant_query_attempt` and run the query.
 * To roll back instantly without shipping code, set TENANT_GUARD_MODE=warn
 * and restart. Unknown values fail closed to `block`.
 *
 * Never guarded: admin context (platform admins query across tenants) and
 * no context at all (webhooks, workers, OAuth callbacks).
 */

export type GuardMode = 'block' | 'warn';
export type GuardDecision = 'allow' | 'warn' | 'block';

export interface GuardContext {
    tenantId?: string;
    userId?: string;
    adminId?: string;
}

export const GUARDED_OPERATIONS: ReadonlySet<string> = new Set([
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'findUnique',
    'findUniqueOrThrow',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'count',
    'aggregate',
    'groupBy',
]);

/**
 * True if `where` carries a tenantId filter, at the top level or through a
 * `tenantId_*` compound unique key.
 */
export function hasTenantFilter(where: unknown): boolean {
    if (!where || typeof where !== 'object') return false;
    const w = where as Record<string, unknown>;
    if (typeof w.tenantId === 'string' || (w.tenantId && typeof w.tenantId === 'object')) {
        return true;
    }
    return Object.keys(w).some((k) => k.startsWith('tenantId_'));
}

export function resolveGuardMode(raw: string | undefined): GuardMode {
    return raw?.trim().toLowerCase() === 'warn' ? 'warn' : 'block';
}

export interface GuardInput {
    model: string;
    operation: string;
    where: unknown;
    ctx: GuardContext | undefined;
    mode: GuardMode;
    /** TENANT_SCOPED_MODELS from prisma.ts (passed in to avoid a cycle). */
    scopedModels: ReadonlySet<string>;
}

export function guardDecision(input: GuardInput): GuardDecision {
    const { model, operation, where, ctx, mode, scopedModels } = input;
    if (!scopedModels.has(model) || !GUARDED_OPERATIONS.has(operation)) return 'allow';
    if (!ctx?.tenantId || ctx.adminId) return 'allow';
    if (hasTenantFilter(where)) return 'allow';
    return mode === 'warn' ? 'warn' : 'block';
}

/**
 * Thrown in block mode. Deliberately a plain Error with statusCode 500: the
 * error handler's fallthrough logs it (model + operation only, no row data)
 * and tells the client nothing beyond a generic message.
 */
export class TenantGuardError extends Error {
    readonly statusCode = 500;
    constructor(
        readonly model: string,
        readonly operation: string,
    ) {
        super(`Tenant guard blocked ${model}.${operation}: query has no tenantId filter`);
        this.name = 'TenantGuardError';
    }
}
