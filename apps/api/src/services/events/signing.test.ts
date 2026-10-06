import { describe, expect, it } from 'vitest';
import { computeSignature, signPayload, verifySignature } from './signing.js';

const secret = 'whsec_test';
const body = '{"id":"e1","data":{"n":"ünï ✓"}}';
const at = new Date('2026-10-06T10:00:00Z');

describe('webhook signing', () => {
    it('produces t=<unix>,v1=<hex hmac of "t.body">', () => {
        const header = signPayload(secret, body, at);
        const t = Math.floor(at.getTime() / 1000);
        expect(header).toBe(`t=${t},v1=${computeSignature(secret, t, body)}`);
        expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    });

    it('verifies a fresh, untampered payload', () => {
        expect(verifySignature({ secret, header: signPayload(secret, body, at), rawBody: body, now: at })).toEqual({ ok: true });
    });

    it('rejects a tampered body, wrong secret, and wrong timestamp', () => {
        const header = signPayload(secret, body, at);
        expect(verifySignature({ secret, header, rawBody: body + ' ', now: at })).toEqual({ ok: false, reason: 'mismatch' });
        expect(verifySignature({ secret: 'other', header, rawBody: body, now: at })).toEqual({ ok: false, reason: 'mismatch' });
        const forged = header.replace(/t=\d+/, `t=${Math.floor(at.getTime() / 1000) + 1}`);
        expect(verifySignature({ secret, header: forged, rawBody: body, now: at })).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('rejects replays outside the tolerance window', () => {
        const header = signPayload(secret, body, at);
        const later = new Date(at.getTime() + 301_000);
        expect(verifySignature({ secret, header, rawBody: body, now: later })).toEqual({ ok: false, reason: 'stale' });
        expect(verifySignature({ secret, header, rawBody: body, now: later, toleranceSec: 600 })).toEqual({ ok: true });
    });

    it('rejects malformed headers', () => {
        for (const header of [undefined, null, '', 'garbage', 't=abc,v1=zz', 'v1=' + 'a'.repeat(64), `t=1`, 'x'.repeat(600)]) {
            expect(verifySignature({ secret, header: header as any, rawBody: body, now: at })).toEqual({ ok: false, reason: 'malformed' });
        }
    });

    it('accepts any matching v1 (rotation overlap)', () => {
        const t = Math.floor(at.getTime() / 1000);
        const header = `t=${t},v1=${'0'.repeat(64)},v1=${computeSignature(secret, t, body)}`;
        expect(verifySignature({ secret, header, rawBody: body, now: at })).toEqual({ ok: true });
    });
});
