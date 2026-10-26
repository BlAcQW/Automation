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
import { emailButton, emailLink, emailParagraph, escapeHtml, renderEmailLayout, renderEmailText } from './email-layout.js';

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
    const text = renderEmailText([
        `Hi ${first},`,
        '',
        'Someone asked to reset the password for your Bookly account. If that was you, open this link to choose a new one:',
        '',
        args.link,
        '',
        'The link works for one hour and can only be used once.',
        '',
        'If you did not ask for this, you can ignore this email. Your password has not changed.',
    ]);
    const html = renderEmailLayout({
        title: subject,
        preheader: 'Choose a new password. The link works for one hour.',
        heading: "Let's get you back in",
        bodyHtml: [
            emailParagraph(`Hi ${escapeHtml(first)},`),
            emailParagraph('Someone asked to reset the password for your Bookly account. If that was you, tap the button to choose a new one.'),
            emailButton('Choose a new password', args.link),
            emailParagraph(
                `The link works for one hour and can only be used once. If the button does not open, copy this address into your browser:<br>${emailLink(args.link, args.link)}`,
                { small: true, muted: true },
            ),
        ].join('\n'),
        footerNote: "Didn't ask for this? You can ignore this email. Your password has not changed.",
    });
    return { subject, text, html };
}

