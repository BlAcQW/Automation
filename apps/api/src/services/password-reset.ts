/**
 * Password-reset tokens without a table.
 *
 * The token is an HMAC over `{ sub, exp }` keyed with the JWT secret *and
 * the user's current password hash*. That second ingredient is what makes
 * it single-use for free: the moment the password changes, every token
 * issued against the old hash stops verifying. No row to insert, expire,
 * or clean up, and a leaked token is useless after it has been used once.
 *
 * Trade-off: a user can hold several valid tokens at once (they asked
 * twice). All die together on the first successful reset, which is what
 * you want.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a reset link works. Long enough for a slow inbox, not a day. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

export interface ResetTokenUser {
    id: string;
    passwordHash: string;
}

interface Payload {
    sub: string;
    exp: number; // unix seconds
}

function signPayload(payloadB64: string, secret: string, passwordHash: string): string {
    return createHmac('sha256', `${secret}:${passwordHash}`).update(payloadB64).digest('base64url');
}

export function createResetToken(user: ResetTokenUser, secret: string, now = Date.now()): string {
    const payload: Payload = { sub: user.id, exp: Math.floor(now / 1000) + RESET_TOKEN_TTL_SECONDS };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${payloadB64}.${signPayload(payloadB64, secret, user.passwordHash)}`;
}

/**
 * Read the payload WITHOUT verifying it. Only for finding which user to
 * load; trust nothing in it until `verifyResetToken` has passed.
 */
export function parseResetToken(token: string): { userId: string; exp: number } | null {
    const [payloadB64] = token.split('.');
    if (!payloadB64) return null;
    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<Payload>;
        if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number') return null;
        return { userId: parsed.sub, exp: parsed.exp };
    } catch {
        return null;
    }
}

export function verifyResetToken(
    token: string,
    user: ResetTokenUser,
    secret: string,
    now = Date.now(),
): boolean {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return false;

    const expected = signPayload(payloadB64, secret, user.passwordHash);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    const payload = parseResetToken(token);
    if (!payload || payload.userId !== user.id) return false;
    return payload.exp > Math.floor(now / 1000);
}

/** The email. Plain, short, one link. */
export function passwordResetEmail(args: { name: string; link: string }): {
    subject: string;
    text: string;
    html: string;
} {
    const first = args.name.trim().split(' ')[0] || 'there';
    const subject = 'Reset your Bookly password';
    const text = [
        `Hi ${first},`,
        '',
        'Someone asked to reset the password for your Bookly account. If that was you, open this link to choose a new one:',
        '',
        args.link,
        '',
        'The link works for one hour and can only be used once.',
        '',
        'If you did not ask for this, you can ignore this email. Your password has not changed.',
    ].join('\n');
    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A0F0D">
  <p style="font-size:16px">Hi ${escapeHtml(first)},</p>
  <p style="font-size:16px;line-height:1.5">Someone asked to reset the password for your Bookly account. If that was you, choose a new one here:</p>
  <p style="margin:28px 0">
    <a href="${args.link}" style="display:inline-block;background:#10B981;color:#050807;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px;font-size:16px">Choose a new password</a>
  </p>
  <p style="font-size:14px;color:#5C6B65;line-height:1.5">The link works for one hour and can only be used once. If the button does not open, copy this address into your browser:<br><a href="${args.link}" style="color:#047857">${args.link}</a></p>
  <p style="font-size:14px;color:#5C6B65;line-height:1.5">If you did not ask for this, ignore this email. Your password has not changed.</p>
</div>`;
    return { subject, text, html };
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
