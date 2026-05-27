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
