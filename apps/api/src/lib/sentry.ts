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
