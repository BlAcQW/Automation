/**
 * API-key authentication for the public API (D2).
 *
 *   preHandler: app.authenticateApiKey(['messages:write'])
 *
 * Reads `Authorization: Bearer bk_live_...`, and on success sets
 * `request.apiKey` and binds the tenant context (so the Prisma tenant guard
 * applies to API traffic exactly as it does to dashboard traffic).
 *
 * ERRORS  401 for anything wrong with the key (one generic message: missing,
 * malformed, unknown, wrong secret, revoked and a switched-off tenant are
 * indistinguishable), 403 for a valid key that lacks a scope, 429 for rate
 * limits.
 *
 * RATE LIMITS  Two, deliberately separate:
 *  - per key (default 120/min), counted only AFTER the key verified, so someone
 *    who knows a key's public prefix cannot burn that key's quota with forged
 *    secrets;
 *  - failed authentications (default 30/min per source address AND key prefix),
 *    checked BEFORE verification and recorded only when verification fails.
 *    Keying on the prefix as well means one caller hammering a bad key cannot
 *    lock other valid keys out from the same address (matters when many
 *    tenants share an egress IP). A coarser per-address flood bound (default
 *    10x, i.e. 300/min) stops someone evading the first by rotating prefixes.
 *    request.ip is the real client only when Fastify trustProxy is set (config
 *    TRUST_PROXY, default 'loopback'); otherwise behind nginx everyone is
 *    127.0.0.1.
 * Routes using this must set `config: { rateLimit: false }` so the global
 * per-IP limiter (which runs earlier and shares a once-per-request flag) does
 * not pre-empt the per-key one.
 *
 * Requires the 'prisma' and 'auth' plugins ('auth' opens the tenant-context
 * store that bindTenantContext writes into).
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { bindTenantContext } from '../lib/tenant-context.js';
import { verifyApiKey, touchLastUsed, hasScopes, parseApiKey, type ApiKeyScope } from '../services/api-keys.js';
import { scoped } from '../lib/logger.js';

const log = scoped('api-key-auth');

export interface ApiKeyIdentity {
    id: string;
    tenantId: string;
    prefix: string;
    scopes: string[];
    name: string;
}

declare module 'fastify' {
    interface FastifyInstance {
        authenticateApiKey: (
            requiredScopes?: ApiKeyScope[],
        ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
    interface FastifyRequest {
        apiKey?: ApiKeyIdentity;
    }
}

export interface ApiKeyAuthOptions {
    /** Requests per minute per key. */
    perKeyLimit?: number;
    /** Failed authentications per minute per (source address, key prefix). */
    failureLimit?: number;
    /** Failed authentications per minute per source address, any prefix. Default 10x failureLimit. */
    ipFailureLimit?: number;
}

const WINDOW_MS = 60_000;
const MAX_TRACKED_ADDRESSES = 5_000;
const BEARER = /^Bearer\s+(\S+)$/i;

/** Fixed-window failure counter. In-memory: per instance, which is a bound, not a guarantee. */
class FailureLimiter {
    private readonly hits = new Map<string, { count: number; resetAt: number }>();
    constructor(private readonly limit: number) {}

    blocked(ip: string, now = Date.now()): boolean {
        const e = this.hits.get(ip);
        return !!e && e.resetAt > now && e.count >= this.limit;
    }

    record(ip: string, now = Date.now()): void {
        const e = this.hits.get(ip);
        if (e && e.resetAt > now) {
            e.count += 1;
            return;
        }
        if (this.hits.size >= MAX_TRACKED_ADDRESSES) this.prune(now);
        this.hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    }

    private prune(now: number): void {
        for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
        // Still full of live entries (a flood): drop the oldest rather than grow.
        if (this.hits.size >= MAX_TRACKED_ADDRESSES) {
            const first = this.hits.keys().next().value;
            if (first !== undefined) this.hits.delete(first);
        }
    }
}

const apiKeyAuthPlugin: FastifyPluginAsync<ApiKeyAuthOptions> = async (fastify, opts) => {
    if (!fastify.hasDecorator('rateLimit')) {
        await fastify.register(rateLimit, { global: false });
    }

    const failureLimit = opts.failureLimit ?? 30;
    const failuresByKey = new FailureLimiter(failureLimit);
    const failuresByIp = new FailureLimiter(opts.ipFailureLimit ?? failureLimit * 10);
    const perKey = (fastify as any).rateLimit({
        max: opts.perKeyLimit ?? 120,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => `apikey:${req.apiKey?.prefix ?? req.ip}`,
    }) as (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

    const unauthorized = () => fastify.httpErrors.unauthorized('Invalid or missing API key');

    fastify.decorate('authenticateApiKey', (requiredScopes: ApiKeyScope[] = []) => {
        return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
            const match = BEARER.exec(request.headers.authorization ?? '');
            const keyBucket = `${request.ip}|${(match && parseApiKey(match[1])?.prefix) || '-'}`;

            // Check first (a blocked bucket costs no DB lookup) ...
            if (failuresByIp.blocked(request.ip) || failuresByKey.blocked(keyBucket)) {
                throw fastify.httpErrors.tooManyRequests('Too many failed authentication attempts. Try again shortly.');
            }

            const verified = match ? await verifyApiKey((fastify as any).prisma, match[1]) : null;
            if (!verified) {
                // ... and count only a failed verification.
                failuresByKey.record(keyBucket);
                failuresByIp.record(request.ip);
                throw unauthorized();
            }

            request.apiKey = {
                id: verified.id,
                tenantId: verified.tenantId,
                prefix: verified.prefix,
                scopes: verified.scopes,
                name: verified.name,
            };
            // Bind BEFORE any tenant-scoped query so the Prisma guard applies.
            bindTenantContext({ tenantId: verified.tenantId });
            request.log = request.log.child({ tenantId: verified.tenantId, apiKeyPrefix: verified.prefix });

            if (!hasScopes(verified.scopes, requiredScopes)) {
                throw fastify.httpErrors.forbidden(
                    `This API key does not have the required scope: ${requiredScopes.join(', ')}`,
                );
            }

            await perKey(request, reply);

            // Advisory and throttled: never let it fail or slow the request.
            void touchLastUsed((fastify as any).prisma, verified).catch((err) =>
                log.warn({ err, apiKeyPrefix: verified.prefix }, 'lastUsedAt update failed'),
            );
        };
    });
};

export default fp(apiKeyAuthPlugin, {
    name: 'api-key-auth',
    dependencies: ['prisma', 'auth'],
});
