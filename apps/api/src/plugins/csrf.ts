import fp from 'fastify-plugin';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';

/**
 * Cross-site login support (D7).
 *
 * Two parts that always ship together:
 *  1. `crossSiteCookieOptions` — refresh-cookie attributes. Flag off returns
 *     exactly the legacy attributes (SameSite=Lax, Secure only in production).
 *     Flag on returns SameSite=None; Secure; HttpOnly so a console on another
 *     site can use the cookie.
 *  2. The CSRF hook — SameSite=None means the browser attaches the cookie to
 *     requests from any site, so cookie-authenticated, state-changing routes
 *     must prove the request came from one of our own origins:
 *       - `Origin` must exactly equal an entry of config.corsOrigins, AND
 *       - a custom header (X-Requested-With) must be present. A cross-site
 *         <form> cannot set custom headers, and a cross-site fetch that sets
 *         one needs a CORS preflight that only allowed origins pass.
 *     Requests carrying no refresh cookie (mobile clients sending the token in
 *     the body) have no ambient credential to abuse and are left alone.
 *
 * Register AFTER the cookie plugin is not required (the raw Cookie header is
 * read), but it must be registered before the routes it protects:
 *     await app.register(csrfPlugin);
 */

export const CSRF_HEADER = 'x-requested-with';

/** Cookie-authenticated, state-changing routes, and the cookie each relies on. */
const PROTECTED: ReadonlyArray<{ path: string; cookie: string }> = [
    { path: '/auth/refresh', cookie: 'refreshToken' },
    { path: '/auth/logout', cookie: 'refreshToken' },
    { path: '/admin/auth/refresh', cookie: 'adminRefreshToken' },
    { path: '/admin/auth/logout', cookie: 'adminRefreshToken' },
];

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function crossSiteCookieOptions(
    base: { path: string; maxAge?: number },
    opts: { crossSite: boolean; nodeEnv: string } = { crossSite: config.crossSiteAuth, nodeEnv: config.nodeEnv },
): CookieSerializeOptions {
    if (opts.crossSite) {
        return { httpOnly: true, secure: true, sameSite: 'none', ...base };
    }
    return { httpOnly: true, secure: opts.nodeEnv === 'production', sameSite: 'lax', ...base };
}

/**
 * Options for clearing the cookie. Flag off: the legacy `{ path }` only. Flag
 * on: a cross-site response may not set a Lax cookie, so the deletion header
 * must carry the same SameSite=None; Secure attributes or browsers ignore it.
 */
export function crossSiteClearOptions(
    path: string,
    opts: { crossSite: boolean } = { crossSite: config.crossSiteAuth },
): CookieSerializeOptions {
    return opts.crossSite ? { httpOnly: true, secure: true, sameSite: 'none', path } : { path };
}

function hasCookie(header: string | undefined, name: string): boolean {
    if (!header) return false;
    return header.split(';').some((part) => part.trim().startsWith(`${name}=`));
}

function resolvedRoute(request: FastifyRequest): string | undefined {
    const url: string | undefined = request.routeOptions?.url ?? (request as { routerPath?: string }).routerPath;
    if (!url) return undefined;
    return url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url;
}

export interface CsrfOptions {
    enabled?: boolean;
    origins?: string[];
}

const csrfPlugin: FastifyPluginAsync<CsrfOptions> = async (fastify, opts) => {
    const enabled = opts.enabled ?? config.crossSiteAuth;
    if (!enabled) return; // flag off: behave exactly as before
    const origins = new Set(opts.origins ?? config.corsOrigins);

    fastify.addHook('onRequest', async (request, reply) => {
        if (!UNSAFE_METHODS.has(request.method)) return;
        // Match the route Fastify RESOLVED, never the raw URL: `/auth/%72efresh`,
        // `/auth/refresh;x` and `/auth/refresh/` all route to the refresh
        // handler but are different strings. The router already decoded and
        // normalised them; routeOptions.url is the registered pattern (with any
        // plugin prefix). 404s have none, and no handler runs for them.
        const path = resolvedRoute(request);
        const rule = path ? PROTECTED.find((r) => r.path === path) : undefined;
        if (!rule) return;
        if (!hasCookie(request.headers.cookie, rule.cookie)) return;

        const origin = request.headers.origin;
        const header = request.headers[CSRF_HEADER];
        const originOk = typeof origin === 'string' && origins.has(origin);
        const headerOk = typeof header === 'string' && header.length > 0;
        if (!originOk || !headerOk) {
            request.log.warn({ path, originOk, headerOk }, 'csrf: rejected cookie-authenticated request');
            return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cross-site request rejected' });
        }
    });
};

export default fp(csrfPlugin, { name: 'csrf' });
