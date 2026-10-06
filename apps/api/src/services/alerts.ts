import { createHash } from 'node:crypto';
/**
 * PlatformAlert: things a human must look at (unattributed money, failed
 * payouts, refund failures...). Repeats of the same condition share a
 * dedupeKey, so they bump a counter instead of flooding the table, and a
 * recurrence reopens an alert someone had already resolved.
 *
 * raiseAlert NEVER throws. Alerting is a side channel; it must not break the
 * money or message path that is reporting the problem.
 */

import type { Prisma } from '@prisma/client';
import { captureAlertEvent } from '../lib/sentry.js';
import { scoped } from '../lib/logger.js';

const log = scoped('alerts');

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface RaiseAlertInput {
    kind: string;
    severity: AlertSeverity;
    tenantId?: string | null;
    message: string;
    context?: Record<string, unknown>;
    dedupeKey: string;
}

/** The slice of the Prisma client alerts need (raw or `$extends`-wrapped). */
export interface AlertsPrisma {
    platformAlert: {
        upsert: (args: any) => Promise<unknown>;
        update: (args: any) => Promise<unknown>;
    };
}

// Message, key and context can carry outside data (a payment reference, a
// purpose name, an error string) — bound them so no caller can grow a row
// without limit.
const MAX_MESSAGE = 500;
const MAX_KEY = 200;
const MAX_STRING = 300;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;
const MAX_CONTEXT_JSON = 4_000;

/** Long keys keep a readable head plus a fingerprint, so distinct keys never merge. */
export function boundKey(key: string): string {
    if (key.length <= MAX_KEY) return key;
    const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 16);
    return `${key.slice(0, MAX_KEY - fingerprint.length - 1)}#${fingerprint}`;
}

function boundValue(value: unknown, depth: number): unknown {
    if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => boundValue(v, depth + 1));
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS).map(([k, v]) => [k, boundValue(v, depth + 1)]),
    );
}

export function boundContext(context: unknown): Prisma.InputJsonValue | undefined {
    if (context === undefined || context === null) return undefined;
    const bounded = boundValue(context, 0);
    return (JSON.stringify(bounded).length > MAX_CONTEXT_JSON ? { truncated: true } : bounded) as Prisma.InputJsonValue;
}

export async function raiseAlert(prisma: AlertsPrisma, input: RaiseAlertInput): Promise<void> {
    const tenantId = input.tenantId ?? null;
    const context = boundContext(input.context);
    const dedupeKey = boundKey(input.dedupeKey);
    const message = input.message.slice(0, MAX_MESSAGE);
    const now = new Date();

    try {
        await prisma.platformAlert.upsert({
            where: { dedupeKey },
            create: {
                kind: input.kind,
                severity: input.severity,
                tenantId,
                message,
                context,
                dedupeKey,
                firstSeenAt: now,
                lastSeenAt: now,
            },
            update: {
                count: { increment: 1 },
                lastSeenAt: now,
                message,
                severity: input.severity,
                context,
                // A recurrence reopens it.
                resolvedAt: null,
                resolvedBy: null,
            },
        });
    } catch (err) {
        log.error({ err, kind: input.kind, dedupeKey }, 'Failed to persist platform alert');
    }

    try {
        // Tags only: no message/context, which can carry customer details.
        captureAlertEvent({ kind: input.kind, severity: input.severity, tenantId });
    } catch (err) {
        log.error({ err, kind: input.kind }, 'Failed to report alert to Sentry');
    }
}

export async function resolveAlert(prisma: AlertsPrisma, id: string, by: string): Promise<void> {
    await prisma.platformAlert.update({
        where: { id },
        data: { resolvedAt: new Date(), resolvedBy: by },
    });
}
