import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
    tenantId?: string;
    userId?: string;
    adminId?: string;
}

/**
 * Per-request tenant context, threaded through async work via
 * AsyncLocalStorage. Populated by the `authenticate` / `authenticateAdmin`
 * decorators; consumed by the Prisma `$extends` guard so cross-tenant
 * query attempts surface as warnings.
 */
export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
    return tenantContext.getStore();
}

/**
 * Fastify `onRequest` hook: opens a per-request store that lives for the whole
 * request, before authentication runs.
 *
 * Why this exists: `enterWith()` called after an `await` inside an async hook
 * (as `authenticate` does after `await request.jwtVerify()`) only affects that
 * hook's own continuation. Fastify then runs the next hook / handler from a
 * different promise reaction, which never sees it. Opening the store here and
 * mutating it later (see bindTenantContext) is visible everywhere downstream
 * because every async continuation shares the same object reference.
 */
export function tenantContextOnRequest(
    _request: unknown,
    _reply: unknown,
    done: () => void,
): void {
    tenantContext.run({}, done);
}

/**
 * Attach identity to the current request's store. The store is deliberately
 * mutated (it is the one shared per-request cell); with no open store it falls
 * back to enterWith for scripts and tests.
 */
export function bindTenantContext(ctx: TenantContext): void {
    const store = tenantContext.getStore();
    if (store) {
        Object.assign(store, ctx);
    } else {
        tenantContext.enterWith({ ...ctx });
    }
}
