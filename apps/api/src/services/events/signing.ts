/**
 * Webhook signing. Header:  X-Bookly-Signature: t=<unix seconds>,v1=<hex>
 * where v1 = HMAC-SHA256(secret, "<t>.<raw body>"). Receivers should verify with
 * the RAW request bytes, compare in constant time, and reject old timestamps
 * (verifySignature does all three).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Bookly-Signature';
export const EVENT_HEADER = 'X-Bookly-Event';
export const DELIVERY_HEADER = 'X-Bookly-Delivery';
export const DEFAULT_TOLERANCE_SEC = 300;

export function computeSignature(secret: string, timestamp: number, rawBody: string | Buffer): string {
    return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export function signPayload(secret: string, rawBody: string | Buffer, now: Date = new Date()): string {
    const t = Math.floor(now.getTime() / 1000);
    return `t=${t},v1=${computeSignature(secret, t, rawBody)}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'malformed' | 'stale' | 'mismatch' };

export function verifySignature(args: {
    secret: string;
    header: string | undefined | null;
    rawBody: string | Buffer;
    toleranceSec?: number;
    now?: Date;
}): VerifyResult {
    const { secret, header, rawBody } = args;
    if (!header || typeof header !== 'string' || header.length > 500) return { ok: false, reason: 'malformed' };
    let t: number | null = null;
    const candidates: string[] = [];
    for (const part of header.split(',')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
        else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) candidates.push(v.toLowerCase());
    }
    if (t === null || candidates.length === 0) return { ok: false, reason: 'malformed' };
    const nowSec = Math.floor((args.now ?? new Date()).getTime() / 1000);
    if (Math.abs(nowSec - t) > (args.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) return { ok: false, reason: 'stale' };
    const expected = Buffer.from(computeSignature(secret, t, rawBody), 'hex');
    const match = candidates.some((c) => {
        const buf = Buffer.from(c, 'hex');
        return buf.length === expected.length && timingSafeEqual(buf, expected);
    });
    return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}
