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
// filter — while a tenant context is active — trigger a warning.
const TENANT_SCOPED_MODELS = new Set([
    'Booking',
    'Service',
    'Product',
    'Order',
    'OrderItem',
    'Conversation',
    'Message',
    'WorkingHours',
    'BlackoutDate',
    'CalendarIntegration',
    'CalendarEvent',
    'Notification',
    'MessageTemplate',
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
function hasTenantFilter(where: unknown): boolean {
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
