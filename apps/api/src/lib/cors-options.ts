import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * CORS for the dashboard and for external consoles listed in CORS_ORIGINS
 * (e.g. TURBO's). Credentials allow the refresh cookie; Retry-After is
 * exposed so a console on another origin can show the server's exact wait
 * after a 429 (e.g. "ask for a new code in 0:42").
 */
export function corsOptions(origins: FastifyCorsOptions['origin']): FastifyCorsOptions {
    return {
        origin: origins,
        credentials: true,
        exposedHeaders: ['Retry-After'],
    };
}
