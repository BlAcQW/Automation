/**
 * Gmail SMTP — per-tenant email fallback channel.
 *
 * Uses Gmail's SMTP gateway directly via nodemailer. Each tenant connects
 * their own Gmail address + 16-char App Password (regular Gmail passwords
 * are rejected by Google since 2022).
 *
 * Transport: smtp.gmail.com:465 (SSL).
 *
 * Never throws — returns `{ ok, error }` so the worker can decide retry.
 */

import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { config } from '../config/index.js';
import { decrypt } from './crypto.js';

const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_PORT = 465;

/**
 * Pick SMTP transport host/port/secure for a given credentials source.
 * Tenant-connected Gmail always uses Gmail's SMTP gateway. The platform
 * fallback respects SMTP_HOST/PORT/SECURE env so an operator can swap to
 * a non-Gmail provider (SendGrid, Mailgun) later without code changes.
 */
function transportTarget(source?: 'tenant' | 'platform'): {
    host: string;
    port: number;
    secure: boolean;
} {
    if (source === 'platform') {
        return {
            host: config.platformGmail.host,
            port: config.platformGmail.port,
            secure: config.platformGmail.secure,
        };
    }
    return { host: GMAIL_HOST, port: GMAIL_PORT, secure: true };
}

export type GmailStep = 'config' | 'verify' | 'send' | 'eauth';

export class GmailError extends Error {
    constructor(public readonly step: GmailStep, public readonly details: string) {
        super(`gmail_${step}: ${details}`);
        this.name = 'GmailError';
    }
}

export interface SendEmailArgs {
    user: string;        // sender SMTP user (decrypted)
    appPassword: string; // 16-char Google App Password (decrypted)
    fromName?: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    /** Source of the credentials. Determines which SMTP host to use. */
    source?: 'tenant' | 'platform';
}

export interface SendEmailResult {
    ok: boolean;
    error?: string;
    messageId?: string;
}

export interface VerifyGmailResult {
    ok: boolean;
    error?: string;
}

function buildTransport(
    user: string,
    appPassword: string,
    source?: 'tenant' | 'platform',
) {
    const { host, port, secure } = transportTarget(source);
    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass: appPassword },
    } satisfies SMTPTransport.Options);
}

function isAuthError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const code = (err as { code?: string }).code;
    const response = (err as { response?: string }).response;
    return code === 'EAUTH' || (typeof response === 'string' && response.includes('535-5.7.8'));
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
    if (!args.user || !args.appPassword) {
        return { ok: false, error: 'gmail_config: user and appPassword are required' };
    }
    if (!args.to || !args.subject) {
        return { ok: false, error: 'gmail_send: to and subject are required' };
    }

    const transport = buildTransport(args.user, args.appPassword, args.source);
    const from = args.fromName ? `${args.fromName} <${args.user}>` : args.user;

    try {
        const info = await transport.sendMail({
            from,
            to: args.to,
            subject: args.subject,
            text: args.text,
            html: args.html,
        });
        return { ok: true, messageId: info.messageId };
    } catch (err) {
        if (isAuthError(err)) {
            return { ok: false, error: `gmail_eauth: ${(err as Error).message}` };
        }
        return { ok: false, error: `gmail_send: ${(err as Error).message}` };
    } finally {
        transport.close();
    }
}

/**
 * Probe the credentials with transporter.verify(). Used by /email/connect to
 * validate the app password before persisting it.
 */
export async function verifyGmailCreds(args: {
    user: string;
    appPassword: string;
}): Promise<VerifyGmailResult> {
    if (!args.user || !args.appPassword) {
        return { ok: false, error: 'gmail_config: user and appPassword are required' };
    }
    const transport = buildTransport(args.user, args.appPassword);
    try {
        await transport.verify();
        return { ok: true };
    } catch (err) {
        if (isAuthError(err)) {
            return { ok: false, error: `gmail_eauth: ${(err as Error).message}` };
        }
        return { ok: false, error: `gmail_verify: ${(err as Error).message}` };
    } finally {
        transport.close();
    }
}

// ---------------------------------------------------------------------------
// Phase 5a — credentials resolver (tenant-first, platform fallback)
// ---------------------------------------------------------------------------

export interface ResolvedGmailCreds {
    user: string;
    appPassword: string;
    fromName?: string;
    source: 'tenant' | 'platform';
}

/**
 * Resolve Gmail credentials for an outbound email send.
 *
 *   1. Per-tenant Gmail (Phase 5) — the tenant has connected their own
 *      Gmail in Settings. Decrypt the stored app password and use it; the
 *      From: header carries the tenant's brand.
 *   2. Platform Gmail (Phase 5a) — BOOKINGFLOW_GMAIL_USER +
 *      BOOKINGFLOW_GMAIL_APP_PASSWORD are set in env. Used as the
 *      shared sender for every tenant who hasn't connected their own.
 *   3. Neither — return null. Caller treats this as 'not_configured' and
 *      the email fallback layer is skipped silently.
 *
 * Never throws. Decryption failure on the tenant password falls through to
 * the platform layer so a corrupt stored secret doesn't break delivery.
 */
export function resolveGmailCreds(args: {
    tenantGmailUser: string | null;
    tenantGmailAppPasswordEncrypted: string | null;
    tenantGmailFromName: string | null;
}): ResolvedGmailCreds | null {
    if (args.tenantGmailUser && args.tenantGmailAppPasswordEncrypted) {
        try {
            return {
                user: args.tenantGmailUser,
                appPassword: decrypt(args.tenantGmailAppPasswordEncrypted),
                fromName: args.tenantGmailFromName ?? undefined,
                source: 'tenant',
            };
        } catch {
            // Decrypt failure (rotated ENCRYPTION_KEY, corrupted row) — fall
            // through to the platform layer rather than dropping the send.
        }
    }

    const platform = config.platformGmail;
    if (platform.user && platform.appPassword) {
        return {
            user: platform.user,
            appPassword: platform.appPassword,
            fromName: platform.fromName,
            source: 'platform',
        };
    }

    return null;
}
