/**
 * Email verification links, built the same way as password-reset tokens:
 * an HMAC over `{ sub, email, exp }` keyed with the JWT secret. Verifying
 * checks the token against the address currently on the account, so a link
 * sent to an old address stops working the moment the email changes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const VERIFY_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface VerifyTokenUser {
    id: string;
    email: string;
}

interface Payload {
    sub: string;
    email: string;
    exp: number;
}

function sign(payloadB64: string, secret: string): string {
    return createHmac('sha256', `${secret}:verify-email`).update(payloadB64).digest('base64url');
}

export function createVerifyToken(user: VerifyTokenUser, secret: string, now = Date.now()): string {
    const payload: Payload = {
        sub: user.id,
        email: user.email.toLowerCase(),
        exp: Math.floor(now / 1000) + VERIFY_TOKEN_TTL_SECONDS,
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${b64}.${sign(b64, secret)}`;
}

/** Returns the verified user id, or null. Never throws. */
export function verifyEmailToken(token: string, secret: string, now = Date.now()): { userId: string; email: string } | null {
    const [b64, signature] = token.split('.');
    if (!b64 || !signature) return null;
    const expected = sign(b64, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const p = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as Partial<Payload>;
        if (typeof p.sub !== 'string' || typeof p.email !== 'string' || typeof p.exp !== 'number') return null;
        if (p.exp <= Math.floor(now / 1000)) return null;
        return { userId: p.sub, email: p.email };
    } catch {
        return null;
    }
}

export function verificationEmail(args: { name: string; businessName: string; link: string }): {
    subject: string;
    text: string;
    html: string;
} {
    const first = args.name.trim().split(' ')[0] || 'there';
    const subject = 'Confirm your email for Bookly';
    const text = [
        `Hi ${first},`,
        '',
        `Welcome to Bookly. Please confirm this is your email address so we can reach you about ${args.businessName}:`,
        '',
        args.link,
        '',
        'The link works for 7 days. If you did not create a Bookly account, you can ignore this email.',
    ].join('\n');
    const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A0F0D">
  <p style="font-size:16px">Hi ${esc(first)},</p>
  <p style="font-size:16px;line-height:1.5">Welcome to Bookly. Please confirm this is your email address so we can reach you about ${esc(args.businessName)}.</p>
  <p style="margin:28px 0">
    <a href="${args.link}" style="display:inline-block;background:#10B981;color:#050807;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:12px;font-size:16px">Confirm my email</a>
  </p>
  <p style="font-size:14px;color:#5C6B65;line-height:1.5">The link works for 7 days. If the button does not open, copy this address into your browser:<br><a href="${args.link}" style="color:#047857">${args.link}</a></p>
  <p style="font-size:14px;color:#5C6B65;line-height:1.5">If you did not create a Bookly account, ignore this email.</p>
</div>`;
    return { subject, text, html };
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
