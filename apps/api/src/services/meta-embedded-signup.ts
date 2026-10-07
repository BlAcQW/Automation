import crypto from 'node:crypto';
import { META_GRAPH_BASE, formBody, scrubMetaText } from './meta-graph.js';
import { config } from '../config/index.js';

const GRAPH_BASE = META_GRAPH_BASE;

export type EmbeddedSignupStep =
    | 'token_exchange'
    | 'token_check'
    | 'waba_discovery'
    | 'phone_discovery'
    | 'subscribe_app'
    | 'register_number'
    | 'set_two_step_pin'
    | 'config';

export class EmbeddedSignupError extends Error {
    readonly details: string;
    constructor(public readonly step: EmbeddedSignupStep, details: string) {
        const safe = scrubMetaText(details, 500);
        super(`embedded_signup_${step}: ${safe}`);
        this.name = 'EmbeddedSignupError';
        this.details = safe;
    }
}

export interface EmbeddedSignupResult {
    accessToken: string;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName?: string;
    tokenExpiresAt?: Date | null;
    /** The two-step PIN the number was registered with. Store it encrypted. */
    registrationPin: string;
}

interface TokenExchangeResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
}

interface PhoneNumbersResponse {
    data?: Array<{
        id: string;
        display_phone_number: string;
        verified_name?: string;
    }>;
}

export interface DebugTokenData {
    app_id?: string;
    type?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
}

/** The scopes whose target_ids name the WABAs this token was granted. */
const WABA_SCOPES = new Set(['whatsapp_business_management', 'whatsapp_business_messaging']);

async function fetchJson<T>(url: string, init: RequestInit | undefined, step: EmbeddedSignupStep): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (err) {
        throw new EmbeddedSignupError(step, `network_error: ${(err as Error).message}`);
    }
    if (!response.ok) {
        let body = '';
        try {
            body = await response.text();
        } catch {
            /* ignore */
        }
        throw new EmbeddedSignupError(step, `http_${response.status}: ${body}`);
    }
    try {
        return (await response.json()) as T;
    } catch (err) {
        throw new EmbeddedSignupError(step, `invalid_json: ${(err as Error).message}`);
    }
}

/**
 * Inspect a token with our app token. Sent as a POST form (method=GET) so
 * neither the tenant token nor the app secret ever sits in a URL.
 */
export async function debugToken(inputToken: string, step: EmbeddedSignupStep = 'token_check'): Promise<DebugTokenData> {
    const { appId, appSecret } = config.whatsapp;
    if (!appId || !appSecret) {
        throw new EmbeddedSignupError('config', 'WHATSAPP_APP_ID and WHATSAPP_APP_SECRET must both be set');
    }
    const form = formBody({ method: 'GET', input_token: inputToken, access_token: `${appId}|${appSecret}` });
    const r = await fetchJson<{ data?: DebugTokenData }>(`${GRAPH_BASE}/debug_token`, { method: 'POST', ...form }, step);
    return r.data ?? {};
}

/** Pure: the WABA ids a token was granted, from debug_token's granular scopes. */
export function grantedWabaIds(data: DebugTokenData): string[] {
    const ids = new Set<string>();
    for (const g of data.granular_scopes ?? []) {
        if (WABA_SCOPES.has(g.scope)) for (const id of g.target_ids ?? []) ids.add(id);
    }
    return [...ids];
}

/**
 * Fail closed unless the token is valid and was issued to OUR app. Anything
 * else (debug_token failing, another app's token) is refused.
 */
export function assertTokenIsOurs(data: DebugTokenData, step: EmbeddedSignupStep = 'token_check'): void {
    if (data.is_valid !== true) throw new EmbeddedSignupError(step, 'token is not valid');
    if (!config.whatsapp.appId || data.app_id !== config.whatsapp.appId) {
        throw new EmbeddedSignupError(step, 'token was not issued to this app');
    }
}

/**
 * What the WA_EMBEDDED_SIGNUP `message` event reported when the popup
 * finished (`data.waba_id`, `data.phone_number_id`). Never trusted on its own:
 * the WABA must be one the token was granted, and the number must belong to it.
 */
export interface EmbeddedSignupSessionHint {
    wabaId?: string;
    phoneNumberId?: string;
}

/** Pure: pick the WABA, or explain why it cannot be picked. Never "the first one". */
export function chooseWaba(granted: string[], hinted: string | undefined): string {
    if (hinted) {
        if (!granted.includes(hinted)) {
            throw new EmbeddedSignupError('waba_discovery', 'The WhatsApp Business Account from the signup session was not granted to this app');
        }
        return hinted;
    }
    if (granted.length === 1) return granted[0];
    if (granted.length === 0) throw new EmbeddedSignupError('waba_discovery', 'No WhatsApp Business Account was granted to this app');
    throw new EmbeddedSignupError('waba_discovery', 'Several WhatsApp Business Accounts were granted; send waba_id from the signup session');
}

/** Pure: pick the phone number on that WABA, or explain why it cannot be picked. */
export function choosePhone<P extends { id: string }>(phones: P[], hinted: string | undefined): P {
    if (hinted) {
        const p = phones.find((x) => x.id === hinted);
        if (!p) throw new EmbeddedSignupError('phone_discovery', 'The phone number chosen in the signup window is not on that WhatsApp Business Account');
        return p;
    }
    if (phones.length === 1) return phones[0];
    if (phones.length === 0) throw new EmbeddedSignupError('phone_discovery', 'WABA has no phone numbers registered');
    throw new EmbeddedSignupError('phone_discovery', 'That WhatsApp Business Account has several numbers; send phone_number_id from the signup session');
}

/** A random 6-digit two-step PIN, one per number. */
export function newRegistrationPin(): string {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Graph error #133005: the number already has a two-step PIN and ours does not match it. */
export function isTwoStepPinMismatch(err: unknown): boolean {
    return err instanceof EmbeddedSignupError && err.step === 'register_number' && /\b133005\b/.test(err.details);
}

/**
 * Register the number for Cloud API with `pin` as its two-step code.
 *
 * A number that already has a two-step PIN (set in the WhatsApp app or by a
 * previous provider) refuses registration with another PIN (#133005). Then the
 * business token sets the number's two-step code to our PIN (Meta's "set
 * two-step verification code": POST /{phone_number_id}, form pin=...) and
 * registration is retried once. If Meta will not set it, or the retry still
 * mismatches, the step is `set_two_step_pin`: only the owner can turn two-step
 * verification off in WhatsApp Manager.
 */
async function registerWithPin(phoneNumberId: string, pin: string, authHeader: { Authorization: string }): Promise<void> {
    const register = () =>
        fetchJson<{ success?: boolean }>(
            `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/register`,
            {
                method: 'POST',
                headers: { ...authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
            },
            'register_number',
        );
    try {
        await register();
        return;
    } catch (err) {
        if (!isTwoStepPinMismatch(err)) throw err;
    }

    const form = formBody({ pin });
    await fetchJson<{ success?: boolean }>(
        `${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}`,
        { method: 'POST', body: form.body, headers: { ...authHeader, ...form.headers } },
        'set_two_step_pin',
    );
    try {
        await register();
    } catch (err) {
        if (isTwoStepPinMismatch(err)) {
            throw new EmbeddedSignupError('set_two_step_pin', `two-step PIN still mismatched after reset: ${(err as EmbeddedSignupError).details}`);
        }
        throw err;
    }
}

/**
 * Complete Meta's WhatsApp Embedded Signup:
 *   1. Exchange the code for the customer's business token (POST form).
 *   2. debug_token (mandatory): valid, issued to our app, and which WABAs it
 *      was granted. Fails closed.
 *   3. Choose the WABA: the session's waba_id if it is among the granted ones,
 *      else the only granted one. Several and no hint is an error.
 *   4. Choose the number on that WABA the same way.
 *   5. Subscribe our app to the WABA so inbound webhooks fire.
 *   6. Register the number for Cloud API with a fresh random PIN (resetting
 *      an existing two-step PIN to it first if Meta reports #133005).
 *
 * Each step throws an `EmbeddedSignupError` tagged with the failing step.
 */
export async function completeEmbeddedSignup(
    code: string,
    redirectUri?: string,
    hint: EmbeddedSignupSessionHint = {},
): Promise<EmbeddedSignupResult> {
    if (!config.whatsapp.appId || !config.whatsapp.appSecret) {
        throw new EmbeddedSignupError('config', 'WHATSAPP_APP_ID and WHATSAPP_APP_SECRET must both be set');
    }

    // Step 1 — token exchange. Web (FB JS SDK) omits redirect_uri; the native
    // WebView flow must replay the https redirect the code was issued for.
    const exchange: Record<string, string> = {
        client_id: config.whatsapp.appId,
        client_secret: config.whatsapp.appSecret,
        code,
    };
    if (redirectUri) exchange.redirect_uri = redirectUri;
    const token = await fetchJson<TokenExchangeResponse>(
        `${GRAPH_BASE}/oauth/access_token`,
        { method: 'POST', ...formBody(exchange) },
        'token_exchange',
    );
    if (!token.access_token) {
        throw new EmbeddedSignupError('token_exchange', 'response missing access_token');
    }

    // Step 2 — mandatory token check.
    const debug = await debugToken(token.access_token);
    assertTokenIsOurs(debug);
    const granted = grantedWabaIds(debug);

    // Step 3 — the WABA.
    const wabaId = chooseWaba(granted, hint.wabaId);

    const authHeader = { Authorization: `Bearer ${token.access_token}` } as const;

    // Step 4 — the number, which must be on that WABA.
    const phones = await fetchJson<PhoneNumbersResponse>(
        `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
        { headers: authHeader },
        'phone_discovery',
    );
    const phone = choosePhone(phones.data ?? [], hint.phoneNumberId);

    // Step 5 — subscribe our app to the WABA.
    await fetchJson<{ success?: boolean }>(
        `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/subscribed_apps`,
        { method: 'POST', headers: authHeader },
        'subscribe_app',
    );

    // Step 6 — register for Cloud API (else every send fails with #133010).
    // The PIN becomes the number's two-step code; it is per number and random.
    const registrationPin = newRegistrationPin();
    await registerWithPin(phone.id, registrationPin, authHeader);

    const expiresAt = token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : debug.expires_at && debug.expires_at > 0 ? new Date(debug.expires_at * 1000) : null;

    return {
        accessToken: token.access_token,
        wabaId,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        verifiedName: phone.verified_name,
        tokenExpiresAt: expiresAt,
        registrationPin,
    };
}

export type { PhoneNumbersResponse };
