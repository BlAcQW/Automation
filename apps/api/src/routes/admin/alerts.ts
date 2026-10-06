import { z } from 'zod';

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export const alertListQuerySchema = z.object({
    status: z.enum(['open', 'resolved']).default('open'),
    severity: z.enum(ALERT_SEVERITIES).optional(),
    tenantId: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AlertListQuery = z.infer<typeof alertListQuerySchema>;

export function buildAlertWhere(q: AlertListQuery) {
    return {
        resolvedAt: q.status === 'open' ? null : { not: null },
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
    };
}
