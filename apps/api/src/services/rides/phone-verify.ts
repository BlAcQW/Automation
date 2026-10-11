/**
 * Confirming a phone number for a WhatsApp customer who hides theirs.
 *
 * With WhatsApp usernames a customer can message TURBO without sharing their
 * number (we only get a BSUID). TURBO still needs a real number — drivers call
 * the rider, receipts go to it — and a number typed in chat is only a claim:
 * trusting it would let anyone open (or empty) someone else's rides account.
 * So the flow asks for the number, texts a one-time code to it, and only links
 * the account once the customer sends that code back.
 *
 * Stateless by design: the pending code lives in the flow's own variables as an
 * HMAC (keyed by a server secret) of conversation + phone + code + expiry. The
 * code itself is never stored, and the customer cannot forge the hash because
 * they can only write the variables the flow's questions set.
 */

import crypto from 'node:crypto';

/** How long a code stays valid. */
export const CODE_TTL_MS = 10 * 60_000;
/** Wrong codes allowed per code before the customer must request a new one. */
export const MAX_CODE_ATTEMPTS = 5;
/** Codes one flow session may send (each costs an SMS). */
export const MAX_CODE_SENDS = 3;

export interface PendingCode {
    codeHash: string;
    expiresAt: number;
}

function hmac(secret: string, parts: Array<string | number>): string {
    return crypto.createHmac('sha256', `turbo-phone-verify:${secret}`).update(parts.join('|')).digest('hex');
}

/** A fresh 6-digit code and its hash, bound to this conversation and number. */
export function issueCode(args: { secret: string; conversationId: string; phone: string; now?: number }): PendingCode & { code: string } {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = (args.now ?? Date.now()) + CODE_TTL_MS;
    return { code, expiresAt, codeHash: hmac(args.secret, [args.conversationId, args.phone, code, expiresAt]) };
}

export type CodeCheck = 'ok' | 'wrong' | 'expired' | 'invalid';

/** Compare a code the customer sent with the pending one. Constant-time. */
export function checkCode(args: {
    secret: string;
    conversationId: string;
    phone: string;
    input: string;
    pending: { codeHash?: unknown; expiresAt?: unknown };
    now?: number;
}): CodeCheck {
    const expiresAt = Number(args.pending.expiresAt);
    const codeHash = typeof args.pending.codeHash === 'string' ? args.pending.codeHash : '';
    if (!codeHash || !Number.isFinite(expiresAt)) return 'invalid';
    if ((args.now ?? Date.now()) > expiresAt) return 'expired';
    const code = args.input.replace(/\D/g, '');
    if (code.length !== 6) return 'wrong';
    const expected = Buffer.from(codeHash, 'hex');
    const actual = Buffer.from(hmac(args.secret, [args.conversationId, args.phone, code, expiresAt]), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) ? 'ok' : 'wrong';
}

export function codeSmsText(code: string): string {
    return `Your TURBO code is ${code}. It expires in 10 minutes. Don't share it with anyone.`;
}
