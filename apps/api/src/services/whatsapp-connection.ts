/**
 * The organisation-facing WhatsApp connection: one vocabulary for the status,
 * the error codes and the connect/disconnect bookkeeping, shared by the
 * dashboard routes (routes/whatsapp/connection.ts), external consoles that
 * call the same routes with a Bearer token, and the platform admin
 * (routes/admin/channels.ts).
 *
 * Pure parts (status, errors, prefill) are unit-tested; `disconnectWhatsapp`
 * does the I/O and is best-effort on the Meta side.
 */

import { ApiError } from './api-error.js';
import {
    NumberOnboardingError,
    deleteHostedNumber,
    isPlatformWabaConfigured,
    resendVerificationCode,
    listPlatformNumberIds,
} from './meta-number-onboarding.js';
import { EmbeddedSignupError } from './meta-embedded-signup.js';
import { GraphError, inspectToken, listWabaPhoneIds, unsubscribeApp } from './meta-waba.js';
import { createHash } from 'node:crypto';
import { decrypt } from './crypto.js';
import { config } from '../config/index.js';
import { META_GRAPH_VERSION } from './meta-graph.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export const CONNECTION_MODES = ['OWN_ACCOUNT', 'BOOKLY_HOSTED', 'MANUAL'] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

/** Seconds a hosted OTP must age before another can be requested. */
export const OTP_RESEND_COOLDOWN_SEC = 60;

/**
 * Exact origins the Embedded Signup popup posts its WA_EMBEDDED_SIGNUP
 * message from. Consoles must match event.origin against this set exactly.
 */
export const EMBEDDED_SIGNUP_MESSAGE_ORIGINS = [
    'https://www.facebook.com',
    'https://web.facebook.com',
    'https://business.facebook.com',
] as const;

/** The SDK version consoles pass to FB.init for Embedded Signup v4. */
export const EMBEDDED_SIGNUP_SDK_VERSION = META_GRAPH_VERSION;

// ---------------------------------------------------------------- errors ----

export const WA_ERRORS = {
    OWNER_ONLY: [403, 'Only the organisation owner can change the WhatsApp connection.'],
    HOSTED_NOT_AVAILABLE: [503, 'Bookly-hosted WhatsApp numbers are not available yet. Connect your own WhatsApp Business account instead.'],
    HOSTED_CAPACITY_FULL: [503, 'All Bookly-hosted numbers are in use right now. Connect your own WhatsApp Business account instead.'],
    EMBEDDED_SIGNUP_NOT_AVAILABLE: [503, 'Connecting your own WhatsApp account is not set up on this Bookly server yet.'],
    ALREADY_CONNECTED: [409, 'A WhatsApp number is already connected. Disconnect it first.'],
    NUMBER_IN_USE: [409, 'That phone number is already connected to another Bookly organisation.'],
    NUMBER_ALREADY_ON_WHATSAPP: [409, 'That number already has a WhatsApp account. Delete WhatsApp on that phone (Settings > Account > Delete my account), wait a few minutes, then try again, or use a different number.'],
    INVALID_NUMBER: [400, 'That phone number does not look right. Check the country code and number.'],
    NO_PENDING_VERIFICATION: [409, 'No number is waiting for a verification code.'],
    INVALID_OTP: [400, 'That code was not accepted. Check the digits, or send a new code.'],
    TOO_MANY_ATTEMPTS: [429, 'Too many attempts. Wait a while before trying again; each retry extends the wait.'],
    RESEND_TOO_SOON: [429, 'A code was sent moments ago. Wait a minute before asking for another.'],
    CODE_SEND_FAILED: [502, 'We could not send the code to that number. Check it can receive SMS, or try a voice call.'],
    TWO_STEP_PIN_LOCKED: [409, 'This WhatsApp number has two-step verification turned on, and Meta would not let Bookly change its PIN. Turn it off in WhatsApp Manager: Phone numbers > (your number) > Settings > Two-step verification > Turn off two-step verification. Then connect again.'],
    META_ERROR: [502, 'WhatsApp (Meta) did not accept the request. Try again in a few minutes.'],
    NOT_CONNECTED: [409, 'WhatsApp is not connected.'],
    MANUAL_CREDENTIALS_INVALID: [400, 'Those WhatsApp details could not be verified with Meta: the token must belong to Bookly\'s app and the number must be on that WhatsApp Business Account.'],
    COUNTRY_NOT_SUPPORTED: [400, 'Bookly-hosted numbers are not available for that country yet. Connect your own WhatsApp Business account instead.'],
    EMAIL_NOT_VERIFIED: [403, 'Verify your email address before setting up a Bookly-hosted number.'],
    DESTINATION_LIMIT: [429, 'Too many codes have been sent to that number today. Try again tomorrow or use a different number.'],
    HOSTED_BUSY: [429, 'Bookly-hosted number setup is busy right now. Try again in an hour.'],
    START_IN_PROGRESS: [409, 'A hosted number setup is already in progress for this organisation. Wait a moment and check the status.'],
} as const satisfies Record<string, readonly [number, string]>;

export type WaErrorCode = keyof typeof WA_ERRORS;

export function waError(code: WaErrorCode, message?: string, retryAfterSec?: number): ApiError {
    const [status, fallback] = WA_ERRORS[code];
    return new ApiError(status, code, message ?? fallback, retryAfterSec);
}

const RATE_LIMITED = /\brate[ -]?limit|too many|\b(133016|130429|136024|80007)\b/i;

/** Turn a hosted-onboarding failure into a stable code a client can act on. */
export function classifyOnboardingError(err: NumberOnboardingError): ApiError {
    const d = err.details.toLowerCase();
    if (err.step === 'config') return waError('HOSTED_NOT_AVAILABLE');
    if (err.step === 'validate') return waError('INVALID_NUMBER', err.details.replace(/^number_onboarding_validate: /, ''));
    if (RATE_LIMITED.test(err.details)) return waError('TOO_MANY_ATTEMPTS');
    if (d.includes('already') && (d.includes('whatsapp') || d.includes('registered') || d.includes('exists') || d.includes('in use'))) {
        return waError('NUMBER_ALREADY_ON_WHATSAPP');
    }
    if (err.step === 'verify_code' || (d.includes('code') && (d.includes('invalid') || d.includes('incorrect') || d.includes('mismatch')))) {
        return waError('INVALID_OTP');
    }
    if (err.step === 'request_code') return waError('CODE_SEND_FAILED');
    return waError('META_ERROR', `WhatsApp setup failed at the ${err.step.replace(/_/g, ' ')} step. Try again in a few minutes.`);
}

/** Embedded Signup failures: config problems vs. Meta refusing a step. */
export function classifyEmbeddedSignupError(err: EmbeddedSignupError): ApiError {
    if (err.step === 'config') return waError('EMBEDDED_SIGNUP_NOT_AVAILABLE');
    if (RATE_LIMITED.test(err.details)) return waError('TOO_MANY_ATTEMPTS');
    if (err.step === 'set_two_step_pin') return waError('TWO_STEP_PIN_LOCKED');
    if (err.step === 'phone_discovery' && err.details.includes('not on that WhatsApp Business Account')) {
        return waError('META_ERROR', 'The number chosen in the Meta window was not found on that WhatsApp account. Start the connection again.');
    }
    const step = err.step.replace(/_/g, ' ');
    return waError('META_ERROR', `Meta did not complete the WhatsApp connection (${step}). Start the connection again; if it keeps failing, contact Bookly support.`);
}

// ---------------------------------------------------------------- status ----

export interface TenantConnectionRow {
    whatsappPhoneNumberId: string | null;
    whatsappDisplayNumber: string | null;
    whatsappHosted: boolean;
    whatsappNumberStatus: string | null;
    whatsappConnectionMode: string | null;
    whatsappConnectedAt: Date | null;
    whatsappVerifiedName: string | null;
    whatsappNameStatus: string | null;
    whatsappCodeMethod: string | null;
    whatsappCodeSentAt: Date | null;
    whatsappQualityRating: string | null;
    whatsappMessagingLimit: string | null;
    whatsappMetaStatus: string | null;
    whatsappHealthProblem: string | null;
    whatsappHealthCheckedAt: Date | null;
    whatsappTokenExpiresAt: Date | null;
}

export const CONNECTION_STATUS_SELECT = {
    whatsappPhoneNumberId: true,
    whatsappDisplayNumber: true,
    whatsappHosted: true,
    whatsappNumberStatus: true,
    whatsappConnectionMode: true,
    whatsappConnectedAt: true,
    whatsappVerifiedName: true,
    whatsappNameStatus: true,
    whatsappCodeMethod: true,
    whatsappCodeSentAt: true,
    whatsappQualityRating: true,
    whatsappMessagingLimit: true,
    whatsappMetaStatus: true,
    whatsappHealthProblem: true,
    whatsappHealthCheckedAt: true,
    whatsappTokenExpiresAt: true,
} as const;

export type ConnectionState = 'NOT_CONNECTED' | 'PENDING_CODE' | 'REGISTERING' | 'CONNECTED' | 'PROBLEM';

export interface WhatsappStatus {
    connected: boolean;
    state: ConnectionState;
    mode: ConnectionMode | null;
    phoneNumberId: string | null;
    displayNumber: string | null;
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    nameStatus: string | null;
    hosted: boolean;
    numberStatus: string | null;
    awaitingCode: boolean;
    connectedAt: Date | null;
    billedBy: 'BOOKLY' | 'ORGANISATION' | null;
    pending: null | {
        step: 'CODE_SENT' | 'CODE_VERIFIED';
        displayNumber: string | null;
        codeMethod: string | null;
        codeSentAt: Date | null;
        resendAvailableAt: Date | null;
    };
    health: {
        qualityRating: string | null;
        messagingLimit: string | null;
        metaStatus: string | null;
        problem: string | null;
        checkedAt: Date | null;
        tokenExpiresAt: Date | null;
    };
    hostedAvailable: boolean;
    hostedUnavailableReason: 'NOT_CONFIGURED' | null;
    embeddedSignupAvailable: boolean;
}

export function parseMode(raw: string | null | undefined): ConnectionMode | null {
    return (CONNECTION_MODES as readonly string[]).includes(raw ?? '') ? (raw as ConnectionMode) : null;
}

/** Hosted numbers between "added to our WABA" and "registered" are not live. */
export const PENDING_HOSTED_STATUSES = ['PENDING_CODE', 'VERIFIED'] as const;

export function isEmbeddedSignupConfigured(): boolean {
    return Boolean(config.whatsapp.appId && config.whatsapp.appSecret && config.whatsapp.configId);
}

export function resendAvailableAt(codeSentAt: Date | null): Date | null {
    return codeSentAt ? new Date(codeSentAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000) : null;
}

/** Pure: the full connection status from the tenant row. Never includes a token. */
export function buildWhatsappStatus(t: TenantConnectionRow | null): WhatsappStatus {
    const hostedAvailable = isPlatformWabaConfigured();
    const hosted = !!t?.whatsappHosted;
    const pendingStatus = hosted && (PENDING_HOSTED_STATUSES as readonly string[]).includes(t?.whatsappNumberStatus ?? '');
    const hasNumber = !!t?.whatsappPhoneNumberId;
    const connected = hasNumber && !pendingStatus;
    const mode = hasNumber ? parseMode(t?.whatsappConnectionMode) ?? (hosted ? 'BOOKLY_HOSTED' : 'OWN_ACCOUNT') : null;
    const verified = t?.whatsappNumberStatus === 'VERIFIED';

    let state: ConnectionState = 'NOT_CONNECTED';
    if (pendingStatus) state = verified ? 'REGISTERING' : 'PENDING_CODE';
    else if (connected) state = t?.whatsappHealthProblem ? 'PROBLEM' : 'CONNECTED';

    return {
        connected,
        state,
        mode,
        phoneNumberId: t?.whatsappPhoneNumberId ?? null,
        displayNumber: t?.whatsappDisplayNumber ?? null,
        displayPhoneNumber: t?.whatsappDisplayNumber ?? null,
        verifiedName: t?.whatsappVerifiedName ?? null,
        nameStatus: t?.whatsappNameStatus ?? null,
        hosted,
        numberStatus: t?.whatsappNumberStatus ?? null,
        awaitingCode: pendingStatus,
        connectedAt: connected ? t?.whatsappConnectedAt ?? null : null,
        billedBy: !hasNumber ? null : hosted ? 'BOOKLY' : 'ORGANISATION',
        pending: pendingStatus
            ? {
                step: verified ? 'CODE_VERIFIED' : 'CODE_SENT',
                displayNumber: t?.whatsappDisplayNumber ?? null,
                codeMethod: t?.whatsappCodeMethod ?? null,
                codeSentAt: t?.whatsappCodeSentAt ?? null,
                resendAvailableAt: resendAvailableAt(t?.whatsappCodeSentAt ?? null),
            }
            : null,
        health: {
            qualityRating: t?.whatsappQualityRating ?? null,
            messagingLimit: t?.whatsappMessagingLimit ?? null,
            metaStatus: t?.whatsappMetaStatus ?? null,
            problem: t?.whatsappHealthProblem ?? null,
            checkedAt: t?.whatsappHealthCheckedAt ?? null,
            tokenExpiresAt: t?.whatsappTokenExpiresAt ?? null,
        },
        hostedAvailable,
        hostedUnavailableReason: hostedAvailable ? null : 'NOT_CONFIGURED',
        embeddedSignupAvailable: isEmbeddedSignupConfigured(),
    };
}

// ----------------------------------------------------------- bookkeeping ----

/** Columns written when a number goes live, whatever the path. Health starts fresh. */
export function connectedData(mode: ConnectionMode, userId: string | null, now: Date = new Date()) {
    return {
        whatsappConnectionMode: mode,
        whatsappConnectedAt: now,
        whatsappConnectedByUserId: userId,
        whatsappQualityRating: null,
        whatsappMessagingLimit: null,
        whatsappMetaStatus: null,
        whatsappHealthProblem: null,
        // NULL puts it at the front of the health sweeper's queue.
        whatsappHealthCheckedAt: null,
    };
}

/** Every WhatsApp column back to "not connected". */
export const CLEARED_WHATSAPP = {
    whatsappPhoneNumberId: null,
    whatsappAccountId: null,
    whatsappAccessToken: null,
    whatsappDisplayNumber: null,
    whatsappHosted: false,
    whatsappNumberStatus: null,
    whatsappRegistrationPin: null,
    whatsappConnectionMode: null,
    whatsappConnectedAt: null,
    whatsappConnectedByUserId: null,
    whatsappVerifiedName: null,
    whatsappNameStatus: null,
    whatsappCodeMethod: null,
    whatsappCodeSentAt: null,
    whatsappQualityRating: null,
    whatsappMessagingLimit: null,
    whatsappMetaStatus: null,
    whatsappHealthProblem: null,
    whatsappHealthCheckedAt: null,
    whatsappTokenExpiresAt: null,
} as const;

export type MetaCleanup = 'released_hosted_number' | 'unsubscribed_app' | 'skipped' | 'failed';

export interface DisconnectOutcome {
    hadNumber: boolean;
    mode: ConnectionMode | null;
    phoneNumberId: string | null;
    displayNumber: string | null;
    metaCleanup: MetaCleanup;
}

interface Log { error: (obj: object, msg: string) => void }

/**
 * Disconnect a tenant's WhatsApp: tidy up on Meta's side (best effort), then
 * clear every WhatsApp column. The caller audits (it knows the actor).
 *
 *  - hosted: the number is deleted from Bookly's WABA, freeing one of the 20
 *    portfolio slots;
 *  - own account / manual: our app is unsubscribed from the tenant's WABA,
 *    unless another Bookly organisation is connected through the same WABA.
 *
 * A Meta failure never blocks the disconnect.
 */
export async function disconnectWhatsapp(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    log: Log,
): Promise<DisconnectOutcome> {
    const db = prisma;
    const t = await db.tenant.findUnique({
        where: { id: tenantId },
        select: {
            whatsappPhoneNumberId: true, whatsappAccountId: true, whatsappAccessToken: true,
            whatsappHosted: true, whatsappDisplayNumber: true, whatsappConnectionMode: true,
        },
    });
    const hadNumber = !!t?.whatsappPhoneNumberId;
    let metaCleanup: MetaCleanup = 'skipped';

    // Decide "is anyone else on this WABA?" and clear the row in one
    // transaction, then talk to Meta outside it (no network inside a tx).
    const shared = await db.$transaction(async (tx) => {
        const others = t?.whatsappAccountId && !t.whatsappHosted
            ? await tx.tenant.count({ where: { whatsappAccountId: t.whatsappAccountId, NOT: { id: tenantId } } })
            : 0;
        await tx.tenant.update({ where: { id: tenantId }, data: CLEARED_WHATSAPP });
        return others;
    });

    if (t?.whatsappHosted && t.whatsappPhoneNumberId) {
        if (isPlatformWabaConfigured()) {
            try {
                await deleteHostedNumber(t.whatsappPhoneNumberId);
                metaCleanup = 'released_hosted_number';
            } catch (err) {
                metaCleanup = 'failed';
                log.error({ reason: (err as Error).message, phoneNumberId: t.whatsappPhoneNumberId },
                    'failed to release hosted number from platform WABA — slot may need manual cleanup');
            }
        }
    } else if (t?.whatsappAccountId && t.whatsappAccessToken && shared === 0) {
        try {
            await unsubscribeApp(t.whatsappAccountId, decrypt(t.whatsappAccessToken));
            metaCleanup = 'unsubscribed_app';
        } catch (err) {
            metaCleanup = 'failed';
            log.error({ reason: (err as Error).message, wabaId: t.whatsappAccountId },
                'failed to unsubscribe app from tenant WABA — its webhooks will be ignored');
        }
    }

    return {
        hadNumber,
        mode: hadNumber ? parseMode(t.whatsappConnectionMode) ?? (t.whatsappHosted ? 'BOOKLY_HOSTED' : 'OWN_ACCOUNT') : null,
        phoneNumberId: t?.whatsappPhoneNumberId ?? null,
        displayNumber: t?.whatsappDisplayNumber ?? null,
        metaCleanup,
    };
}

export interface ResendOutcome {
    success: true;
    codeMethod: 'SMS' | 'VOICE';
    codeSentAt: Date;
    resendAvailableAt: Date | null;
}

/**
 * Re-send the OTP for a hosted number still waiting for its code. Enforces the
 * cool-down (RESEND_TOO_SOON with retryAfterSec) on top of the route's rate
 * limit. Used by the owner's route and the platform admin's "Resend OTP".
 */
export async function resendHostedCode(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    codeMethod: 'SMS' | 'VOICE',
    log: { error: (obj: object, msg: string) => void },
    now: Date = new Date(),
): Promise<ResendOutcome> {
    if (!isPlatformWabaConfigured()) throw waError('HOSTED_NOT_AVAILABLE');
    const db = prisma;
    const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { whatsappPhoneNumberId: true, whatsappHosted: true, whatsappNumberStatus: true, whatsappCodeSentAt: true, whatsappDisplayNumber: true },
    });
    if (!tenant?.whatsappHosted || tenant.whatsappNumberStatus !== 'PENDING_CODE' || !tenant.whatsappPhoneNumberId) {
        throw waError('NO_PENDING_VERIFICATION');
    }
    const availableAt = resendAvailableAt(tenant.whatsappCodeSentAt);
    if (availableAt && availableAt.getTime() > now.getTime()) {
        throw waError('RESEND_TOO_SOON', undefined, Math.ceil((availableAt.getTime() - now.getTime()) / 1000));
    }
    await reserveOtpSend(db, tenant.whatsappDisplayNumber ?? tenant.whatsappPhoneNumberId, 'resend', now);
    try {
        await resendVerificationCode(tenant.whatsappPhoneNumberId, codeMethod);
    } catch (err) {
        if (err instanceof NumberOnboardingError) {
            log.error({ step: err.step, details: err.details }, 'hosted resend failed');
            throw classifyOnboardingError(err);
        }
        throw err;
    }
    await db.tenant.update({
        where: { id: tenantId },
        data: { whatsappCodeMethod: codeMethod, whatsappCodeSentAt: now },
    });
    return { success: true, codeMethod, codeSentAt: now, resendAvailableAt: resendAvailableAt(now) };
}

// --------------------------------------------------------- manual connect ----

/**
 * Prove pasted-in credentials belong together before storing them, so a
 * tenant cannot claim a phone_number_id it does not control (one of Bookly's
 * hosted slots, or another business's number our app is subscribed to) and
 * start receiving its messages. Fails closed: anything unverifiable is refused.
 *
 *  - the account is not Bookly's own WABA;
 *  - the token is valid and was issued to OUR app;
 *  - if the token carries WhatsApp granular scopes, the account is among them;
 *  - the number is on that account, read with that token;
 *  - the number is not one of Bookly's hosted numbers.
 */
export async function verifyManualCredentials(args: { phoneNumberId: string; accountId: string; accessToken: string }): Promise<void> {
    const bad = () => waError('MANUAL_CREDENTIALS_INVALID');
    if (config.platformWhatsapp.wabaId && args.accountId === config.platformWhatsapp.wabaId) throw bad();

    let info;
    try {
        info = await inspectToken(args.accessToken);
    } catch (err) {
        if (err instanceof GraphError && (err.httpStatus === 0 || err.httpStatus >= 500)) throw waError('META_ERROR');
        throw bad();
    }
    if (!info) throw waError('EMBEDDED_SIGNUP_NOT_AVAILABLE');
    if (!info.isValid || !config.whatsapp.appId || info.appId !== config.whatsapp.appId) throw bad();
    if (info.wabaIds.length > 0 && !info.wabaIds.includes(args.accountId)) throw bad();

    let ids: string[];
    try {
        ids = await listWabaPhoneIds(args.accountId, args.accessToken);
    } catch (err) {
        if (err instanceof GraphError && (err.httpStatus === 0 || err.httpStatus >= 500)) throw waError('META_ERROR');
        throw bad();
    }
    if (!ids.includes(args.phoneNumberId)) throw bad();

    if (isPlatformWabaConfigured()) {
        let platformIds: string[];
        try {
            platformIds = await listPlatformNumberIds();
        } catch {
            throw waError('META_ERROR', 'Could not confirm the number is not a Bookly-hosted number. Try again in a few minutes.');
        }
        if (platformIds.includes(args.phoneNumberId)) throw bad();
    }
}

// ------------------------------------------------------- hosted guard rails ----

export const HOSTED_DESTINATION_LIMIT_24H = 5;
export const HOSTED_GLOBAL_LIMIT_PER_HOUR = 30;
/** A hosted number not registered this long after its last code is released. */
export const HOSTED_PENDING_TTL_MS = 30 * 60_000;

/** Is this calling code allowed for hosted numbers? */
export function isHostedCountryAllowed(countryCode: string): boolean {
    const cc = countryCode.replace(/\D/g, '');
    return config.platformWhatsapp.allowedCountryCodes.includes(cc);
}

/** Stable, non-reversible key for an OTP destination (E.164 digits). */
export function destinationHash(e164: string): string {
    return createHash('sha256').update(`wa-otp:${e164.replace(/\D/g, '')}`).digest('hex');
}

/**
 * Record one OTP send and refuse it if it breaks the per-destination (24h) or
 * platform-wide (1h) cap. Insert-then-count, so two racing sends cannot both
 * slip under a limit; a refused send's row is removed again.
 */
export async function reserveOtpSend(prisma: ExtendedPrismaClient, e164: string, kind: 'start' | 'resend', now: Date = new Date()): Promise<void> {
    const hash = destinationHash(e164);
    const row = await prisma.whatsappOtpSend.create({ data: { destinationHash: hash, kind, createdAt: now } });
    const [perDestination, global] = await Promise.all([
        prisma.whatsappOtpSend.count({ where: { destinationHash: hash, createdAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } } }),
        prisma.whatsappOtpSend.count({ where: { createdAt: { gt: new Date(now.getTime() - 3_600_000) } } }),
    ]);
    if (perDestination > HOSTED_DESTINATION_LIMIT_24H || global > HOSTED_GLOBAL_LIMIT_PER_HOUR) {
        await prisma.whatsappOtpSend.delete({ where: { id: row.id } }).catch(() => undefined);
        throw waError(perDestination > HOSTED_DESTINATION_LIMIT_24H ? 'DESTINATION_LIMIT' : 'HOSTED_BUSY');
    }
}

// ---------------------------------------------------------------- prefill ----

/**
 * Meta's Embedded Signup business categories (extras.setup.phone.category),
 * from Meta's "Pre-filling screens" Embedded Signup documentation.
 */
export const META_BUSINESS_CATEGORIES = [
    'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN', 'FINANCE', 'GROCERY', 'GOVT',
    'HOTEL', 'HEALTH', 'NONPROFIT', 'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'OTHER',
] as const;
export type MetaBusinessCategory = (typeof META_BUSINESS_CATEGORIES)[number];

export function categoryFor(vertical: string | null | undefined, businessType: string | null | undefined): MetaBusinessCategory {
    if (vertical === 'RIDES') return 'TRAVEL';
    if (businessType === 'PRODUCT') return 'RETAIL';
    return 'PROF_SERVICES';
}

/** ISO 3166 country from the payment currency, only where the mapping is one-to-one. */
const CURRENCY_COUNTRY: Record<string, string> = {
    GHS: 'GH', NGN: 'NG', KES: 'KE', ZAR: 'ZA', UGX: 'UG', TZS: 'TZ', RWF: 'RW', GBP: 'GB',
};

const OFFSET_PATTERN = /^GMT([+-])(\d{2}):(\d{2})$/;

/** "Africa/Lagos" -> "UTC+01:00" (Meta's format); null when the zone is unknown. */
export function utcOffsetLabel(timeZone: string, at: Date = new Date()): string | null {
    try {
        const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
            .formatToParts(at)
            .find((p) => p.type === 'timeZoneName')?.value;
        if (!part) return null;
        if (part === 'GMT') return 'UTC+00:00';
        const m = part.match(OFFSET_PATTERN);
        return m ? `UTC${m[1]}${m[2]}:${m[3]}` : null;
    } catch {
        return null;
    }
}

export interface PrefillTenant {
    name: string;
    vertical: string | null;
    businessType: string | null;
    timezone: string | null;
    paymentCurrency: string | null;
}

export interface EmbeddedSignupSetup {
    business: {
        name: string;
        email?: string;
        address?: { country: string };
        timezone?: string;
    };
    phone: {
        displayName: string;
        category: MetaBusinessCategory;
        description: string;
    };
}

/** Pure: Meta's extras.setup object from what Bookly knows about the organisation. */
export function buildEmbeddedSignupSetup(t: PrefillTenant, ownerEmail: string | null): EmbeddedSignupSetup {
    const name = t.name.trim().slice(0, 100);
    const country = t.paymentCurrency ? CURRENCY_COUNTRY[t.paymentCurrency.toUpperCase()] : undefined;
    const timezone = t.timezone ? utcOffsetLabel(t.timezone) : null;
    return {
        business: {
            name,
            ...(ownerEmail ? { email: ownerEmail } : {}),
            ...(country ? { address: { country } } : {}),
            ...(timezone ? { timezone } : {}),
        },
        phone: {
            displayName: name,
            category: categoryFor(t.vertical, t.businessType),
            description: '',
        },
    };
}
