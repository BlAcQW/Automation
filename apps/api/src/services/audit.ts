import type { ActorType } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export interface AuditArgs {
    prisma: ExtendedPrismaClient;
    action: string; // e.g. "auth.login.success", "tenant.updated"
    actorType: ActorType;
    tenantId?: string | null;
    actorId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
}

/**
 * Append a row to the AuditLog. Never throws — audit failures must not
 * disrupt the request that triggered them. Failures log to console.error.
 */
export async function audit(args: AuditArgs): Promise<void> {
    try {
        await args.prisma.auditLog.create({
            data: {
                tenantId: args.tenantId ?? null,
                actorType: args.actorType,
                actorId: args.actorId ?? null,
                action: args.action,
                targetType: args.targetType ?? null,
                targetId: args.targetId ?? null,
                metadata: (args.metadata as object) ?? undefined,
                ipAddress: args.ipAddress ?? null,
            },
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('audit log write failed', err, { action: args.action });
    }
}
