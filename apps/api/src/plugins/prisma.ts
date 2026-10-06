import { Prisma, PrismaClient } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { getTenantContext } from '../lib/tenant-context.js';
import {
    GuardMode,
    TenantGuardError,
    guardDecision,
    hasTenantFilter,
    resolveGuardMode,
} from './tenant-guard.js';

declare module 'fastify' {
    interface FastifyInstance {
        prisma: ExtendedPrismaClient;
    }
}

// Tenant-scoped models. An operation on one of these models that omits a
// tenantId filter, while a tenant context is active, is BLOCKED: the guard
// throws TenantGuardError (generic 500 to the client, model + operation logged,
// no row data). Decision logic lives in ./tenant-guard.ts.
//
// Instant rollback: set TENANT_GUARD_MODE=warn and restart. The guard then
// only logs `cross_tenant_query_attempt` and lets the query run. The mode is
// read once at startup; unknown values fail closed to block.
//
// No context (webhooks, workers, OAuth callbacks) and admin context are never
// guarded.
//
// INVARIANT: this set must equal every model with a `tenantId` field in
// schema.prisma. prisma.test.ts enforces that via Prisma.dmmf, so adding a
// tenant-bearing model without registering it fails the test.
//
// Not registered on purpose: Message, OrderItem, CalendarEvent. They have no
// tenantId column and are scoped through their parent relation
// (Conversation, Order, CalendarIntegration). Guarding them would warn on
// every call.
//
// AuditLog.tenantId is nullable (null = platform-admin / system rows). It is
// still registered: those null-tenant rows are only reachable from admin
// context, which the guard skips, and writes (create) are not guarded. A
// tenant-context read of AuditLog without a tenantId filter would leak
// platform rows or other tenants' rows, so it should warn.
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
    'User',
    'PlatformAlert',
    'DeviceToken',
    'Booking',
    'Service',
    'Product',
    'Order',
    'Conversation',
    'WorkingHours',
    'BlackoutDate',
    'CalendarIntegration',
    'Notification',
    'MessageTemplate',
    'PromoRedemption',
    'AuditLog',
    'TenantUsage',
    'Wallet',
    'LedgerMovement',
    'LedgerEntry',
    'PayoutRecipient',
    'PayoutRequest',
    'Customer',
    'FlowDefinition', // tenantId nullable; default rows (null) read only without tenant context
    'ExternalApp',
    'ApiKey',
    'DomainEvent',
    'WebhookSubscription',
    'WebhookDelivery',
    'SupportSession',
    'BillingTerms',
]);

export { hasTenantFilter };

export interface GuardQueryParams {
    model: string;
    operation: string;
    args: unknown;
    query: (args: any) => Promise<unknown>;
}

/**
 * The guard applied to every Prisma operation. Exported so tests can drive it
 * without a database connection.
 */
export function runGuardedQuery(
    { model, operation, args, query }: GuardQueryParams,
    mode: GuardMode,
    log: (entry: Record<string, unknown>) => void = (entry) =>
        // eslint-disable-next-line no-console
        console.warn(JSON.stringify(entry)),
): Promise<unknown> {
    const ctx = getTenantContext();
    const decision = guardDecision({
        model,
        operation,
        where: (args as { where?: unknown } | undefined)?.where,
        ctx,
        mode,
        scopedModels: TENANT_SCOPED_MODELS,
    });
    if (decision !== 'allow') {
        // Log model/operation/tenant only. Never args or row data.
        log({
            msg: 'cross_tenant_query_attempt',
            cross_tenant_query_attempt: true,
            blocked: decision === 'block',
            model,
            operation,
            contextTenantId: ctx?.tenantId,
        });
        if (decision === 'block') {
            return Promise.reject(new TenantGuardError(model, operation));
        }
    }
    return query(args);
}

function buildExtendedClient(base: PrismaClient, mode: GuardMode) {
    return base.$extends({
        name: 'tenant-context-guard',
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    return runGuardedQuery({ model, operation, args, query }, mode);
                },
            },
        },
    });
}

type BasePrisma = PrismaClient<Prisma.PrismaClientOptions, never>;
export type ExtendedPrismaClient = ReturnType<typeof buildExtendedClient>;

const prismaPlugin: FastifyPluginAsync = async (fastify) => {
    const base: BasePrisma = new PrismaClient({
        log: fastify.log.level === 'debug'
            ? ['query', 'info', 'warn', 'error']
            : ['error'],
    });

    await base.$connect();

    const mode = resolveGuardMode(process.env.TENANT_GUARD_MODE);
    fastify.log.info({ tenantGuardMode: mode }, 'tenant guard mode');
    const prisma = buildExtendedClient(base, mode);

    fastify.decorate('prisma', prisma);

    fastify.addHook('onClose', async () => {
        await base.$disconnect();
    });
};

export default fp(prismaPlugin, {
    name: 'prisma',
});
