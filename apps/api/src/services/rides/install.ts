/**
 * Install the RIDES pack for one tenant (TURBO): default ride settings, the
 * "turbo-founding" flow as the tenant's own published version, and the tenant
 * switched to that flow. Idempotent: re-running publishes a new flow version
 * only when the definition changed, and never overwrites existing settings.
 *
 * Used by scripts/seed-turbo.ts. It never chooses a database: it runs against
 * whatever client the caller passes.
 */
import type { PrismaClient } from '@prisma/client';
import { createDefinitionsService, createPrismaFlowStore } from '../flows/index.js';
import { TURBO_FLOW_KEY, turboFoundingFlow } from './turbo-flow.js';

export interface InstallResult {
    settingsCreated: boolean;
    flowVersion: number;
    flowPublished: boolean;
    vertical: string;
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
    if (!active || !sameDefinition(active.definition, turboFoundingFlow)) {
        const row = await service.createVersion({
            tenantId: tenant.id, key: TURBO_FLOW_KEY, definition: turboFoundingFlow, createdBy: args.createdBy ?? 'seed-turbo', activate: true,
        });
        flowVersion = row.version;
        flowPublished = true;
    }

    await db.tenant.update({ where: { id: tenant.id }, data: { conversationMode: 'flow', activeFlowKey: TURBO_FLOW_KEY } });
    return { settingsCreated: !existing, flowVersion, flowPublished, vertical: tenant.vertical };
}
