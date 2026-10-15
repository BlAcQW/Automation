/**
 * Install the RIDES pack for one tenant (TURBO): default ride settings, the
 * "turbo-founding" flow as the tenant's own published version, and the tenant
 * switched to that flow. Idempotent: re-running publishes a new flow version
 * only when the definition changed, and never overwrites existing settings.
 *
 * When it publishes, conversations still mid-flow on an older version
 * (status 'active', e.g. halfway through booking with the old ride-count copy)
 * are handed back (flows/hand-back.ts): their next message starts the new
 * version at its menu. A conversation WAITING on a payment keeps its version,
 * so the payment that lands later still finds its step. Publish only once the
 * API that serves the new version's actions and payment kinds is running.
 *
 * Used by scripts/seed-turbo.ts. It never chooses a database: it runs against
 * whatever client the caller passes.
 */
import type { PrismaClient } from '@prisma/client';
import { createDefinitionsService, createPrismaFlowStore } from '../flows/index.js';
import { flowContextForHandBack } from '../flows/hand-back.js';
import { readFlowState } from '../flows/runner.js';
import { TURBO_FLOW_KEY, turboFoundingFlow } from './turbo-flow.js';

export interface InstallResult {
    settingsCreated: boolean;
    flowVersion: number;
    flowPublished: boolean;
    vertical: string;
    /** Conversations mid-flow on an older version that were handed back to the new one. */
    conversationsReset: number;
}

type ResetDb = Pick<PrismaClient, 'conversation'>;

/** Most conversations one install touches (TURBO has a few hundred at most). */
const RESET_BATCH = 5000;

/**
 * Hand back this tenant's conversations that are mid-flow ('active') on an
 * older version of `flowKey`. Compare-and-set on contextVersion, like every
 * flow state write: a conversation that moved meanwhile is left alone.
 */
export async function resetActiveFlowConversations(db: ResetDb, args: { tenantId: string; flowKey: string; version: number }): Promise<number> {
    const rows = await db.conversation.findMany({
        where: { tenantId: args.tenantId, botContext: { path: ['flow', 'flowKey'], equals: args.flowKey } },
        select: { id: true, botContext: true, contextVersion: true },
        take: RESET_BATCH,
    });
    let reset = 0;
    for (const row of rows) {
        const state = readFlowState(row.botContext);
        if (!state || state.flowKey !== args.flowKey || state.status !== 'active' || state.flowVersion >= args.version) continue;
        const botContext = flowContextForHandBack(row.botContext);
        if (!botContext) continue;
        const { count } = await db.conversation.updateMany({
            where: { id: row.id, tenantId: args.tenantId, contextVersion: row.contextVersion },
            data: { botContext: botContext as object, contextVersion: { increment: 1 } },
        });
        reset += count;
    }
    return reset;
}

/** JSON with object keys sorted, so key order (the schema re-orders on parse) never counts as a change. */
function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
}

function sameDefinition(a: unknown, b: unknown): boolean {
    const strip = (d: unknown) => {
        const { version: _v, ...rest } = (d ?? {}) as Record<string, unknown>;
        return canonical(rest);
    };
    return strip(a) === strip(b);
}

export async function installTurboPack(
    db: PrismaClient,
    args: { tenantId: string; createdBy?: string | null },
): Promise<InstallResult> {
    const tenant = await db.tenant.findUnique({ where: { id: args.tenantId }, select: { id: true, vertical: true } });
    if (!tenant) throw new Error(`Tenant ${args.tenantId} not found`);

    const existing = await db.rideSettings.findFirst({ where: { tenantId: tenant.id } });
    if (!existing) await db.rideSettings.create({ data: { tenantId: tenant.id } });

    const service = createDefinitionsService(createPrismaFlowStore(db));
    const versions = await service.listVersions({ tenantId: tenant.id }, TURBO_FLOW_KEY);
    const active = versions.filter((v) => v.isActive).sort((x, y) => y.version - x.version)[0];
    let flowVersion = active?.version ?? 0;
    let flowPublished = false;
    let conversationsReset = 0;
    if (!active || !sameDefinition(active.definition, turboFoundingFlow)) {
        const row = await service.createVersion({
            tenantId: tenant.id, key: TURBO_FLOW_KEY, definition: turboFoundingFlow, createdBy: args.createdBy ?? 'seed-turbo', activate: true,
        });
        flowVersion = row.version;
        flowPublished = true;
        conversationsReset = await resetActiveFlowConversations(db, { tenantId: tenant.id, flowKey: TURBO_FLOW_KEY, version: flowVersion });
    }

    await db.tenant.update({ where: { id: tenant.id }, data: { conversationMode: 'flow', activeFlowKey: TURBO_FLOW_KEY } });
    return { settingsCreated: !existing, flowVersion, flowPublished, vertical: tenant.vertical, conversationsReset };
}
