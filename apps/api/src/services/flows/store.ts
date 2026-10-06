/**
 * Prisma-backed FlowStore + DefinitionStore. Typed against a minimal
 * structural interface so it compiles whether or not the generated client is
 * current, and so tests can pass a fake.
 *
 * Tenant guard: FlowDefinition and Conversation are tenant-scoped models.
 * Reading platform DEFAULT rows (tenantId null) must happen WITHOUT tenant
 * context (webhook/worker/admin), as noted in schema.prisma. Every query here
 * filters tenantId explicitly.
 */
import type { DefinitionRow, DefinitionScope, DefinitionStore } from './definitions.js';
import type { DefinitionQuery, FlowStore, LoadedConversation, StoredDefinition } from './runner.js';

type Fn = (args: any) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FlowPrismaLike {
    flowDefinition: { findFirst: Fn; findMany: Fn; create: Fn; delete: Fn; updateMany: Fn };
    conversation: { findFirst: Fn; updateMany: Fn };
}

function toStored(row: { key: string; version: number; definition: unknown } | null): StoredDefinition | null {
    return row ? { key: row.key, version: row.version, definition: row.definition } : null;
}

export function createPrismaFlowStore(prisma: FlowPrismaLike): FlowStore & DefinitionStore {
    return {
        async findDefinition(q: DefinitionQuery) {
            const pick = q.version !== undefined ? { version: q.version } : { isActive: true };
            if (q.key !== null) {
                const own = await prisma.flowDefinition.findFirst({
                    where: { tenantId: q.tenantId, key: q.key, ...pick }, orderBy: { version: 'desc' },
                });
                if (own) return toStored(own);
            }
            const dflt = await prisma.flowDefinition.findFirst({
                where: {
                    tenantId: null,
                    ...(q.vertical ? { vertical: q.vertical } : {}),
                    ...(q.key !== null ? { key: q.key } : {}),
                    ...pick,
                },
                orderBy: [{ key: 'asc' }, { version: 'desc' }],
            });
            return toStored(dflt);
        },

        async loadConversation(tenantId, conversationId): Promise<LoadedConversation | null> {
            const c = await prisma.conversation.findFirst({
                where: { id: conversationId, tenantId },
                select: { id: true, customerPhone: true, botContext: true, contextVersion: true },
            });
            return c ? { id: c.id, customerPhone: c.customerPhone ?? null, botContext: c.botContext, contextVersion: c.contextVersion } : null;
        },

        async saveBotContext(tenantId, conversationId, expectedVersion, botContext) {
            const r = await prisma.conversation.updateMany({
                where: { id: conversationId, tenantId, contextVersion: expectedVersion },
                data: { botContext, contextVersion: { increment: 1 } },
            });
            return r.count === 1;
        },

        findVersions(scope: DefinitionScope, key: string): Promise<DefinitionRow[]> {
            return prisma.flowDefinition.findMany({ where: { tenantId: scope.tenantId, key }, orderBy: { version: 'asc' } });
        },
        list(scope: DefinitionScope): Promise<DefinitionRow[]> {
            return prisma.flowDefinition.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ key: 'asc' }, { version: 'desc' }] });
        },
        insert(row) {
            return prisma.flowDefinition.create({ data: row });
        },
        async remove(id) {
            await prisma.flowDefinition.delete({ where: { id } });
        },
        async setActive(scope, key, which, isActive) {
            await prisma.flowDefinition.updateMany({
                where: { tenantId: scope.tenantId, key, version: 'version' in which ? which.version : { gt: which.versionAbove } },
                data: { isActive },
            });
        },
    };
}
