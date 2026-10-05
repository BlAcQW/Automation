import { Prisma, PrismaClient } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { getTenantContext } from '../lib/tenant-context.js';

declare module 'fastify' {
    interface FastifyInstance {
        prisma: ExtendedPrismaClient;
    }
}

// Tenant-scoped models. Operations on these models that omit a tenantId
// filter — while a tenant context is active — trigger a warning (warn-only;
// blocking is a later, staged change).
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
]);

const GUARDED_OPERATIONS = new Set([
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
 * Returns true if the `where` clause includes a tenantId filter, either at
 * the top level or via a `tenantId_*` compound unique key.
 */
export function hasTenantFilter(where: unknown): boolean {
    if (!where || typeof where !== 'object') return false;
    const w = where as Record<string, unknown>;
    if (typeof w.tenantId === 'string' || (w.tenantId && typeof w.tenantId === 'object')) {
        return true;
    }
    for (const k of Object.keys(w)) {
        if (k.startsWith('tenantId_')) return true;
    }
    return false;
}

function buildExtendedClient(base: PrismaClient) {
    return base.$extends({
        name: 'tenant-context-guard',
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    if (
                        TENANT_SCOPED_MODELS.has(model) &&
                        GUARDED_OPERATIONS.has(operation)
                    ) {
                        const ctx = getTenantContext();
                        // Skip when the call is from a platform admin (admins
                        // legitimately query across tenants) or from
                        // unauthenticated paths (webhook, OAuth callback).
                        if (ctx?.tenantId && !ctx.adminId) {
                            const where = (args as { where?: unknown } | undefined)?.where;
                            if (!hasTenantFilter(where)) {
                                // eslint-disable-next-line no-console
                                console.warn(
                                    JSON.stringify({
                                        msg: 'cross_tenant_query_attempt',
                                        cross_tenant_query_attempt: true,
                                        model,
                                        operation,
                                        contextTenantId: ctx.tenantId,
                                    }),
                                );
                            }
                        }
                    }
                    return query(args);
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

    const prisma = buildExtendedClient(base);

    fastify.decorate('prisma', prisma);

    fastify.addHook('onClose', async () => {
        await base.$disconnect();
    });
};

export default fp(prismaPlugin, {
    name: 'prisma',
});
