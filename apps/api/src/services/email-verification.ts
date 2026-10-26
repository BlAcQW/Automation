/**
 * Email verification links, built the same way as password-reset tokens:
 * an HMAC over `{ sub, email, exp }` keyed with the JWT secret. Verifying
 * checks the token against the address currently on the account, so a link
 * sent to an old address stops working the moment the email changes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { emailButton, emailLink, emailParagraph, escapeHtml, renderEmailLayout, renderEmailText } from './email-layout.js';

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
    const text = renderEmailText([
        `Hi ${first},`,
        '',
        `Welcome to Bookly! Please confirm this is your email address so we can reach you about ${args.businessName}:`,
        '',
        args.link,
        '',
        'The link works for 7 days. If you did not create a Bookly account, you can ignore this email.',
    ]);
    const html = renderEmailLayout({
        title: subject,
        preheader: `One tap to confirm your email for ${args.businessName}.`,
        heading: 'Welcome to Bookly!',
        bodyHtml: [
            emailParagraph(`Hi ${escapeHtml(first)},`),
            emailParagraph(`Please confirm this is your email address so we can reach you about <strong>${escapeHtml(args.businessName)}</strong>.`),
            emailButton('Confirm my email', args.link),
            emailParagraph(
                `The link works for 7 days. If the button does not open, copy this address into your browser:<br>${emailLink(args.link, args.link)}`,
                { small: true, muted: true },
            ),
        ].join('\n'),
        footerNote: "Didn't create a Bookly account? You can ignore this email.",
    });
    return { subject, text, html };
}

