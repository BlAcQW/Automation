/**
 * Logger for code that runs outside a request.
 *
 * Inside a route, always prefer `request.log` — it carries the request id, so a
 * support conversation can trace one customer's failure through the logs. This
 * exists for services, workers and startup paths where no request exists.
 *
 * It replaces the `console.log` calls that were scattered through the services:
 * those have no level, no structure and no timestamp, so in production they are
 * either invisible or unfilterable, and they can't be shipped to a log service
 * in the same shape as everything Fastify emits.
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

export const logger = pino({
    // Same levels and pretty-printing as the Fastify instance, so local output
    // stays uniform and production stays machine-readable.
    level: isDev ? 'debug' : 'info',
    transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    base: { scope: 'service' },
});

/** A child logger tagged with the service name, e.g. logger.for('whatsapp-bot'). */
export function scoped(name: string) {
    return logger.child({ service: name });
}
