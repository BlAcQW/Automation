/**
 * Global rate limiting keyed by WHO is calling, not just where from.
 *
 * Background (MONEY-BUILD LOW finding): @fastify/rate-limit runs in `onRequest`,
 * and the `authenticate` decorator runs later (route preHandler), so a
 * keyGenerator reading `req.user` always saw nothing and every limit was
 * per-IP. Moving the limiter to preHandler does not help either: the plugin's
 * hook is registered at the root and so runs BEFORE the route-level
 * authenticate hooks.
 *
 * Instead this plugin verifies the bearer token itself, synchronously and
 * cheaply (HMAC), in an `onRequest` hook that runs just before the limiter:
 *
 *   - valid ACCESS token  -> request.user is populated (same shape
 *     `authenticate` sets), so the limiter, and every per-route keyGenerator
 *     that reads `req.user?.tenantId ?? req.ip`, key by the real user/tenant
 *   - anything else (none, expired, forged, refresh token) -> keyed by IP.
 *     A forged token never earns a fresh bucket, so inventing identities
 *     cannot dodge the limit.
 *   - the /auth surface (login, signup, reset, verify) is ALWAYS per-IP, even
 *     with a valid token: otherwise throwaway accounts would each bring a new
 *     bucket for credential-stuffing someone else's login.
 *
 * Authorization is unchanged: this only reads identity for bucketing;
 * `authenticate` still runs and still decides access.
 *
 * Client IP comes from Fastify's `trustProxy` (config.trustProxy), so behind
 * nginx `req.ip` is the real client, not the proxy.
 */

import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

export const AUTH_SURFACE_PREFIX = '/auth';

export interface RateLimitPluginOptions {
    max?: number;
    timeWindow?: string | number;
}

function isAuthSurface(req: FastifyRequest): boolean {
    const path = req.url.split('?')[0];
    return path === AUTH_SURFACE_PREFIX || path.startsWith(`${AUTH_SURFACE_PREFIX}/`);
}

function bearerToken(req: FastifyRequest): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match ? match[1] : null;
}

const rateLimitPlugin: FastifyPluginAsync<RateLimitPluginOptions> = async (fastify, opts) => {
    fastify.addHook('onRequest', async (req) => {
        if (req.user) return;
        const token = bearerToken(req);
        if (!token || isAuthSurface(req)) return;
        try {
            const decoded = fastify.jwt.verify(token) as unknown as {
                userId?: string;
                tenantId?: string;
                role?: 'OWNER' | 'STAFF';
                type?: string;
            };
            if (decoded?.type !== 'access' || !decoded.userId || !decoded.tenantId || !decoded.role) return;
            req.user = { userId: decoded.userId, tenantId: decoded.tenantId, role: decoded.role };
        } catch {
            // Not a valid identity: stays keyed by IP. authenticate() will reject it.
        }
    });

    await fastify.register(rateLimit, {
        max: opts.max ?? 100,
        timeWindow: opts.timeWindow ?? '1 minute',
        keyGenerator: (req: FastifyRequest) => (req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip}`),
    });
};

export default fp(rateLimitPlugin, { name: 'rate-limit-by-identity' });
