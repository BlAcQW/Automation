import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Initialise Sentry if SENTRY_DSN is set. Idempotent + safe to call before
 * any other module loads. When DSN is unset, every Sentry SDK call elsewhere
 * becomes a no-op.
 */
export function initSentry(): void {
    if (initialized) return;
    initialized = true;

    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;

    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV ?? 'development',
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    });
}

/**
 * Report a platform alert to Sentry. Tags only (kind/severity/tenantId), never
 * message text or context, so no customer data leaves. No-op without a DSN.
 */
export function captureAlertEvent(args: {
    kind: string;
    severity: 'info' | 'warning' | 'critical';
    tenantId?: string | null;
}): void {
    if (!process.env.SENTRY_DSN) return;
    const tags: Record<string, string> = { kind: args.kind, severity: args.severity };
    if (args.tenantId) tags.tenantId = args.tenantId;
    Sentry.captureMessage(`alert: ${args.kind}`, {
        level: args.severity === 'critical' ? 'error' : args.severity === 'warning' ? 'warning' : 'info',
        tags,
    });
}
