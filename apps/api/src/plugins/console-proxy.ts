import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';

/**
 * Trusted client IP from the TURBO console's same-origin proxy.
 *
 * The console (Vercel) relays browser calls to Bookly from `/bookly/*`, so
 * every console request reaches nginx from a Vercel egress address and
 * request.ip would be Vercel, not the staff member: one shared per-IP rate
 * limit bucket for everybody, and useless audit IPs. The console adds:
 *   x-console-client-ip     the browser's IP as Vercel saw it
 *   x-console-proxy-secret  CONSOLE_PROXY_SECRET, shared with the console
 *
 * When the secret matches (timing-safe) and the IP is a valid address, the
 * X-Forwarded-For header is replaced by that IP, so Fastify's trustProxy
 * ('loopback': nginx) resolves request.ip to it. Both headers are then
 * removed. With no secret configured, a wrong or missing secret, or a bad IP,
 * nothing changes except that any x-console-* header is dropped, so a client
 * cannot smuggle one past us.
 *
 * Must be the FIRST onRequest hook (registered before CORS, CSRF, auth and the
 * rate limiter) so everything downstream sees the corrected IP.
 */

export const CONSOLE_SECRET_HEADER = 'x-console-proxy-secret';
export const CONSOLE_IP_HEADER = 'x-console-client-ip';
const CONSOLE_HEADER_PREFIX = 'x-console-';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time compare of the presented header with the configured secret. */
export function consoleSecretMatches(given: unknown, expected: string | undefined): boolean {
    if (!expected || typeof given !== 'string' || given.length === 0) return false;
    // Hashing first gives equal-length buffers, so length differences do not leak.
    return timingSafeEqual(digest(given), digest(expected));
}

/** Applies the forwarded client IP to the raw request (in place: proxy-addr reads raw headers). Returns it, or null. */
export function applyConsoleProxyClientIp(raw: IncomingMessage, secret: string | undefined): string | null {
    const headers = raw.headers;
    const presented = headers[CONSOLE_SECRET_HEADER];
    const ipHeader = headers[CONSOLE_IP_HEADER];
    for (const name of Object.keys(headers)) {
        if (name.startsWith(CONSOLE_HEADER_PREFIX)) delete headers[name];
    }
    if (!consoleSecretMatches(presented, secret)) return null;
    const ip = typeof ipHeader === 'string' ? ipHeader.trim() : '';
    if (isIP(ip) === 0) return null;
    headers['x-forwarded-for'] = ip;
    return ip;
}

export function registerConsoleProxyClientIp(app: FastifyInstance, secret: string | undefined): void {
    app.addHook('onRequest', (request, _reply, done) => {
        const hadSecret = typeof request.raw.headers[CONSOLE_SECRET_HEADER] === 'string';
        const ip = applyConsoleProxyClientIp(request.raw, secret);
        if (hadSecret && !ip && secret) {
            // Misconfiguration signal (secrets differ, or a bad IP); never log the values.
            request.log.warn('console proxy: x-console-proxy-secret did not match or client IP invalid; using the socket chain');
        }
        done();
    });
}
