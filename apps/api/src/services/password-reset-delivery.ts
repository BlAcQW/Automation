/**
 * Issue a password-reset link and email it. Shared by the public
 * forgot-password form and the platform admin's "send reset email" /
 * "copy reset link" actions, so every path mints the same token, builds the
 * link the same way and sends the same message from the platform sender.
 *
 * Nothing here logs the link or the token.
 */
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';
import { resolveGmailCreds, sendEmail } from './gmail-smtp.js';
import { createResetToken, parseResetToken, passwordResetEmail, type ResetTokenUser } from './password-reset.js';
import { buildResetLink, type ResetLinkConfig } from './reset-link.js';

export interface IssuedResetLink {
    link: string;
    expiresAt: Date;
}

/** The reset-link settings from the running config. */
export function resetLinkConfig(): ResetLinkConfig {
    return { nodeEnv: config.nodeEnv, frontendUrl: config.frontendUrl, allowedOrigins: config.corsOrigins };
}

/** Mint a fresh one-hour token for `user` and put it on the page at `base`. */
export function issueResetLink(user: ResetTokenUser, base: string, now = Date.now()): IssuedResetLink {
    const token = createResetToken(user, config.jwtSecret, now);
    const exp = parseResetToken(token)!.exp;
    return { link: buildResetLink(base, token), expiresAt: new Date(exp * 1000) };
}

export type SendResetResult = { ok: true } | { ok: false; reason: 'no_sender' | 'send_failed' };

/**
 * Send the standard reset email. Account email always goes from the platform
 * sender, never from an organisation's connected Gmail: this is Bookly
 * writing to its own customer.
 */
export async function sendResetEmail(
    user: { id: string; name: string; email: string },
    link: string,
    log: FastifyBaseLogger,
): Promise<SendResetResult> {
    const creds = resolveGmailCreds({ tenantGmailUser: null, tenantGmailAppPasswordEncrypted: null, tenantGmailFromName: null });
    if (!creds) {
        log.error({ userId: user.id }, 'Password reset requested but no platform email sender is configured');
        return { ok: false, reason: 'no_sender' };
    }
    const mail = passwordResetEmail({ name: user.name, link });
    const result = await sendEmail({ ...creds, to: user.email, ...mail });
    if (!result.ok) {
        log.error({ err: result.error, userId: user.id }, 'Password reset email failed to send');
        return { ok: false, reason: 'send_failed' };
    }
    return { ok: true };
}
