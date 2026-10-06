/**
 * One outgoing webhook POST. No redirects are followed (a 3xx is just a non-2xx
 * answer), the connect goes through the guarded lookup, the whole exchange is
 * bounded by a timeout, and the response body is read only up to a cap and
 * discarded: it is never stored or logged.
 */
import http from 'node:http';
import https from 'node:https';
import { assertPublicHost, makeGuardedLookup, parseWebhookUrl, type Resolver } from './ssrf.js';

export const DELIVERY_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 64 * 1024;

export interface PostResult {
    statusCode: number;
    /** Bytes read (capped at MAX_RESPONSE_BYTES). */
    bodyBytes: number;
}

export type PostJson = (args: { url: string; headers: Record<string, string>; body: string }) => Promise<PostResult>;

export function makePostJson(opts: { resolver?: Resolver; timeoutMs?: number; maxBytes?: number } = {}): PostJson {
    const timeoutMs = opts.timeoutMs ?? DELIVERY_TIMEOUT_MS;
    const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
    return async ({ url, headers, body }) => {
        const u = parseWebhookUrl(url);
        // IP-literal hosts bypass the socket lookup, so check them (and fail fast on DNS) here.
        await assertPublicHost(u.hostname, opts.resolver);
        const lib = u.protocol === 'https:' ? https : http;
        const payload = Buffer.from(body, 'utf8');

        return new Promise<PostResult>((resolve, reject) => {
            let settled = false;
            const done = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                fn();
            };
            const req = lib.request(
                {
                    protocol: u.protocol,
                    hostname: u.hostname.replace(/^\[|\]$/g, ''),
                    port: u.port || undefined,
                    path: `${u.pathname}${u.search}`,
                    method: 'POST',
                    agent: false,
                    lookup: makeGuardedLookup(opts.resolver) as any,
                    headers: {
                        ...headers,
                        'content-type': 'application/json',
                        'content-length': String(payload.length),
                        'user-agent': 'Bookly-Webhooks/1',
                    },
                },
                (res) => {
                    let bytes = 0;
                    const finish = () => done(() => resolve({ statusCode: res.statusCode ?? 0, bodyBytes: bytes }));
                    res.on('data', (chunk: Buffer) => {
                        bytes += chunk.length;
                        if (bytes >= maxBytes) {
                            bytes = maxBytes;
                            finish();
                            res.destroy();
                        }
                    });
                    res.on('end', finish);
                    res.on('error', () => finish()); // status already known
                    res.on('close', finish);
                },
            );
            const timer = setTimeout(() => {
                req.destroy(new Error(`Timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            timer.unref?.();
            req.on('error', (err) => done(() => reject(err)));
            req.end(payload);
        });
    };
}
