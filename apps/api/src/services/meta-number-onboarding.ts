/**
 * Phase 6 — onboarding a tenant's phone number onto Bookly's OWN WhatsApp
 * Business Account.
 *
 * WHY THIS EXISTS
 * ---------------
 * Embedded Signup ([meta-embedded-signup.ts]) creates a WABA owned by the
 * tenant's own Meta business, which means Meta bills the tenant directly and
 * Bookly can neither see nor mark up that spend. Meta accepts cards, PayPal
 * and direct debit — but not MTN MoMo, Telecel Cash or AirtelTigo, so a
 * Ghanaian business with only Mobile Money cannot pay Meta at all.
 *
 * Hosting the number on Bookly's WABA makes Bookly the party Meta bills, so
 * the tenant pays one cedi bill to Bookly and never touches Meta. The cost is
 * a hard ceiling: a Meta business portfolio may register at most 20 business
 * phone numbers in total (2 before business verification), so this path scales
 * to 20 tenants before Meta has to raise the limit. Bring-your-own via
 * Embedded Signup stays available and consumes none of that allowance.
 *
 * THE META FLOW (4 calls, in order)
 * ---------------------------------
 *   1. POST /{WABA_ID}/phone_numbers      → create the number, returns its id
 *   2. POST /{PHONE_ID}/request_code      → Meta sends an SMS/voice OTP
 *   3. POST /{PHONE_ID}/verify_code       → prove the tenant owns the number
 *   4. POST /{PHONE_ID}/register          → enable it for Cloud API messaging
 *
 * Steps 1–2 run in `startHostedNumber`, steps 3–4 in `verifyAndRegister`,
 * because a human has to read the OTP off a handset in between.
 */

import { config } from '../config/index.js';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Shortest plausible national subscriber number, used to reject typos early. */
const MIN_LOCAL_DIGITS = 6;

export type NumberOnboardingStep =
    | 'config'
    | 'validate'
    | 'create_number'
    | 'request_code'
    | 'verify_code'
    | 'register'
    | 'subscribe_app'
    | 'delete_number';

export class NumberOnboardingError extends Error {
    constructor(
        public readonly step: NumberOnboardingStep,
        public readonly details: string,
    ) {
        super(`number_onboarding_${step}: ${details}`);
        this.name = 'NumberOnboardingError';
    }
}

/**
 * Is the hosted path available at all? Mirrors `isPlatformPaystackConfigured`:
 * when Bookly has no WABA of its own configured, the feature switches off
 * cleanly rather than failing at the first Graph call.
 */
export function isPlatformWabaConfigured(): boolean {
    return Boolean(config.platformWhatsapp.wabaId && config.platformWhatsapp.accessToken);
}

function requirePlatformWaba(): { wabaId: string; accessToken: string } {
    const { wabaId, accessToken } = config.platformWhatsapp;
    if (!wabaId || !accessToken) {
        throw new NumberOnboardingError(
            'config',
            'PLATFORM_WABA_ID and PLATFORM_WHATSAPP_TOKEN must both be set to host numbers',
        );
    }
    return { wabaId, accessToken };
}

/**
 * Reduce a number as a human typed it to the bare subscriber digits Meta wants.
 *
 * Meta takes `cc` and `phone_number` as separate fields, and `phone_number`
 * must NOT carry the national trunk prefix. Ghanaian numbers are universally
 * written with it ("024 123 4567"), so stripping that leading zero is the
 * difference between a number that works and one Meta accepts but nobody can
 * reach. Passing `countryCode` additionally tolerates someone pasting the full
 * international form into the local field.
 */
export function normalizeLocalNumber(input: string, countryCode?: string): string {
    let digits = (input ?? '').replace(/\D/g, '');

    if (countryCode) {
        const cc = countryCode.replace(/\D/g, '');
        if (cc && digits.startsWith(cc) && digits.length > cc.length + MIN_LOCAL_DIGITS - 1) {
            digits = digits.slice(cc.length);
        }
    }

    // National trunk prefix — a single leading zero, never more.
    if (digits.startsWith('0')) digits = digits.slice(1);

    if (!digits) {
        throw new NumberOnboardingError('validate', 'phone number contains no digits');
    }
    if (digits.length < MIN_LOCAL_DIGITS) {
        throw new NumberOnboardingError(
            'validate',
            `phone number looks too short (${digits.length} digits)`,
        );
    }
    return digits;
}

/** Display form, stored on the tenant so the UI can show what was connected. */
export function toE164(countryCode: string, localNumber: string): string {
    const cc = (countryCode ?? '').replace(/\D/g, '');
    if (!cc) {
        throw new NumberOnboardingError('validate', 'country code must be numeric, e.g. 233');
    }
    return `+${cc}${localNumber}`;
}

async function graph<T>(
    path: string,
    init: RequestInit,
    step: NumberOnboardingStep,
    accessToken: string,
): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${GRAPH_BASE}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...(init.headers ?? {}),
            },
        });
    } catch (err) {
        throw new NumberOnboardingError(step, `network_error: ${(err as Error).message}`);
    }

    const raw = await response.text().catch(() => '');
    if (!response.ok) {
        // Meta buries the actionable reason in error.error_user_msg or
        // error.error_data.details while error.message stays a generic
        // "(#100) Invalid parameter" — surface the useful one.
        let detail = raw.slice(0, 500);
        try {
            const parsed = JSON.parse(raw) as {
                error?: {
                    message?: string;
                    error_user_msg?: string;
                    error_data?: { details?: string };
                };
            };
            detail =
                parsed.error?.error_user_msg ??
                parsed.error?.error_data?.details ??
                parsed.error?.message ??
                detail;
        } catch {
            /* keep the raw body */
        }
        throw new NumberOnboardingError(step, `http_${response.status}: ${detail}`);
    }

    try {
        return (raw ? JSON.parse(raw) : {}) as T;
    } catch (err) {
        throw new NumberOnboardingError(step, `invalid_json: ${(err as Error).message}`);
    }
}

/**
 * Subscribe Bookly's app to Bookly's own WABA so inbound webhooks fire for
 * every number on it. Idempotent, and only meaningful once per WABA rather
 * than once per number, but cheap enough to assert on each onboarding.
 */
export async function subscribePlatformWaba(): Promise<void> {
    const { wabaId, accessToken } = requirePlatformWaba();
    await graph<{ success?: boolean }>(
        `/${wabaId}/subscribed_apps`,
        { method: 'POST' },
        'subscribe_app',
        accessToken,
    );
}

export interface StartHostedNumberArgs {
    countryCode: string;
    /** As typed by the tenant; normalised internally. */
    localNumber: string;
    /** Shown to customers in WhatsApp. Meta reviews this asynchronously. */
    verifiedName: string;
    codeMethod?: 'SMS' | 'VOICE';
}

export interface StartHostedNumberResult {
    phoneNumberId: string;
    displayNumber: string;
    codeMethod: 'SMS' | 'VOICE';
}

/**
 * Steps 1–2: put the number on Bookly's WABA and send the tenant an OTP.
 *
 * If step 2 fails we delete the number we just created, otherwise a retry hits
 * "number already exists" and the tenant is stuck behind a half-created record
 * that also consumes one of the 20 slots.
 */
export async function startHostedNumber(
    args: StartHostedNumberArgs,
): Promise<StartHostedNumberResult> {
    const { wabaId, accessToken } = requirePlatformWaba();
    const local = normalizeLocalNumber(args.localNumber, args.countryCode);
    const cc = args.countryCode.replace(/\D/g, '');
    const displayNumber = toE164(cc, local);
    const codeMethod = args.codeMethod ?? 'SMS';

    const created = await graph<{ id?: string }>(
        `/${wabaId}/phone_numbers`,
        {
            method: 'POST',
            body: JSON.stringify({
                cc,
                phone_number: local,
                verified_name: args.verifiedName,
            }),
        },
        'create_number',
        accessToken,
    );

    if (!created.id) {
        throw new NumberOnboardingError('create_number', 'Meta did not return a phone number id');
    }

    try {
        await graph<{ success?: boolean }>(
            `/${created.id}/request_code`,
            {
                method: 'POST',
                body: JSON.stringify({ code_method: codeMethod, language: 'en' }),
            },
            'request_code',
            accessToken,
        );
    } catch (err) {
        await deleteHostedNumber(created.id).catch(() => {
            /* best effort — the original failure is what matters */
        });
        throw err;
    }

    return { phoneNumberId: created.id, displayNumber, codeMethod };
}

/** Re-send the OTP, e.g. after switching from SMS to a voice call. */
export async function resendVerificationCode(
    phoneNumberId: string,
    codeMethod: 'SMS' | 'VOICE' = 'SMS',
): Promise<void> {
    const { accessToken } = requirePlatformWaba();
    await graph<{ success?: boolean }>(
        `/${phoneNumberId}/request_code`,
        { method: 'POST', body: JSON.stringify({ code_method: codeMethod, language: 'en' }) },
        'request_code',
        accessToken,
    );
}

/**
 * Steps 3–4: verify the OTP, then register the number for Cloud API sending.
 *
 * The PIN is the number's two-step-verification code, which Meta requires for
 * Cloud API. It is generated per number and stored encrypted on the tenant so
 * a later re-register (Meta requires one after a display-name change) can
 * reuse it.
 */
export async function verifyAndRegister(
    phoneNumberId: string,
    code: string,
    pin: string,
): Promise<void> {
    const { accessToken } = requirePlatformWaba();

    await graph<{ success?: boolean }>(
        `/${phoneNumberId}/verify_code`,
        { method: 'POST', body: JSON.stringify({ code: code.replace(/\D/g, '') }) },
        'verify_code',
        accessToken,
    );

    await graph<{ success?: boolean }>(
        `/${phoneNumberId}/register`,
        { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }) },
        'register',
        accessToken,
    );
}

/**
 * Remove a hosted number from Bookly's WABA.
 *
 * Called on disconnect, and on a failed onboarding. This matters more than it
 * looks: the portfolio is capped at 20 registered numbers, so an abandoned
 * number that is never deleted permanently costs Bookly a tenant slot.
 */
export async function deleteHostedNumber(phoneNumberId: string): Promise<void> {
    const { accessToken } = requirePlatformWaba();
    await graph<{ success?: boolean }>(
        `/${phoneNumberId}`,
        { method: 'DELETE' },
        'delete_number',
        accessToken,
    );
}

/** How many of the portfolio's number slots are already spoken for. */
export async function countHostedNumbers(): Promise<number> {
    const { wabaId, accessToken } = requirePlatformWaba();
    const res = await graph<{ data?: unknown[] }>(
        `/${wabaId}/phone_numbers?fields=id`,
        { method: 'GET' },
        'create_number',
        accessToken,
    );
    return res.data?.length ?? 0;
}
