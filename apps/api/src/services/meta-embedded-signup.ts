import { config } from '../config/index.js';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type EmbeddedSignupStep =
    | 'token_exchange'
    | 'waba_discovery'
    | 'phone_discovery'
    | 'subscribe_app'
    | 'register_number'
    | 'config';

export class EmbeddedSignupError extends Error {
    constructor(public readonly step: EmbeddedSignupStep, public readonly details: string) {
        super(`embedded_signup_${step}: ${details}`);
        this.name = 'EmbeddedSignupError';
    }
}

export interface EmbeddedSignupResult {
    accessToken: string;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName?: string;
    tokenExpiresAt?: Date | null;
}

interface TokenExchangeResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
}

interface OwnedWabaListResponse {
    data?: Array<{ id: string; name?: string }>;
}

interface PhoneNumbersResponse {
    data?: Array<{
        id: string;
        display_phone_number: string;
        verified_name?: string;
    }>;
}

interface MeWithBusinessesResponse {
    businesses?: {
        data?: Array<{
            id: string;
            name?: string;
        }>;
    };
}

async function fetchJson<T>(url: string, init?: RequestInit, step: EmbeddedSignupStep = 'token_exchange'): Promise<T> {
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
        throw new EmbeddedSignupError(step, `http_${response.status}: ${body.slice(0, 500)}`);
    }
    try {
        return (await response.json()) as T;
    } catch (err) {
        throw new EmbeddedSignupError(step, `invalid_json: ${(err as Error).message}`);
    }
}

/**
 * Complete the Meta WhatsApp Embedded Signup flow:
 *   1. Exchange the Facebook Login code for an access token.
 *   2. Discover the WhatsApp Business Account (WABA) the user just granted us.
 *   3. Get the phone-number-id (and display number / verified business name).
 *   4. Subscribe our app to the WABA so webhooks fire for that number.
 *
 * Each step throws an `EmbeddedSignupError` tagged with which step failed, so
 * the caller can surface a precise message to the operator instead of a
 * generic "connect failed".
 *
 * Multi-WABA / multi-phone selection (when the user owns more than one
 * business or has multiple numbers under one WABA) is a Phase-4 polish item.
 * For now we take the first WABA and the first phone number — documented in
 * the plan.
 */
export async function completeEmbeddedSignup(
    code: string,
    redirectUri?: string,
): Promise<EmbeddedSignupResult> {
    if (!config.whatsapp.appId || !config.whatsapp.appSecret) {
        throw new EmbeddedSignupError(
            'config',
            'WHATSAPP_APP_ID and WHATSAPP_APP_SECRET must both be set',
        );
    }

    // Step 1 — token exchange.
    // Web (FB JS SDK): redirect_uri omitted — the SDK manages its own popup
    // redirect. Native (WebView OAuth): the code IS bound to the https
    // redirect_uri the dialog used, so it MUST be replayed here to match.
    const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', config.whatsapp.appId);
    tokenUrl.searchParams.set('client_secret', config.whatsapp.appSecret);
    tokenUrl.searchParams.set('code', code);
    if (redirectUri) {
        tokenUrl.searchParams.set('redirect_uri', redirectUri);
    }

    const token = await fetchJson<TokenExchangeResponse>(tokenUrl.toString(), undefined, 'token_exchange');
    if (!token.access_token) {
        throw new EmbeddedSignupError('token_exchange', 'response missing access_token');
    }

    const expiresAt = token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null;

    const authHeader = { Authorization: `Bearer ${token.access_token}` } as const;

    // Step 1b — inspect granted scopes via debug_token. If a later call fails
    // with "Missing Permission", we attach the actual granted scopes so the
    // operator can fix the Embedded Signup configuration with confidence.
    interface DebugTokenResponse {
        data?: {
            app_id?: string;
            type?: string;
            scopes?: string[];
            granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
            is_valid?: boolean;
            user_id?: string;
        };
    }

    const debugUrl = new URL(`${GRAPH_BASE}/debug_token`);
    debugUrl.searchParams.set('input_token', token.access_token);
    debugUrl.searchParams.set(
        'access_token',
        `${config.whatsapp.appId}|${config.whatsapp.appSecret}`,
    );

    // Modern Embedded Signup grants `whatsapp_business_management` per-WABA,
    // and debug_token's granular_scopes.target_ids carries those WABA IDs
    // directly. That lets us skip the /me/businesses query (which would
    // require the broader `business_management` scope Meta no longer hands
    // out by default).
    const grantedScopeNames = new Set<string>();
    let wabaIdFromGrant: string | undefined;
    try {
        const debug = await fetchJson<DebugTokenResponse>(debugUrl.toString());
        for (const s of debug.data?.scopes ?? []) grantedScopeNames.add(s);
        for (const g of debug.data?.granular_scopes ?? []) {
            grantedScopeNames.add(g.scope);
            if (g.scope === 'whatsapp_business_management' && g.target_ids?.length) {
                wabaIdFromGrant = g.target_ids[0];
            }
        }
    } catch {
        // debug_token failures are non-blocking — we just lose the fast path.
    }

    // Step 2 — WABA discovery. Prefer the granular target_id; fall back to
    // /me/businesses only when Meta didn't supply one (rare with modern
    // signup configurations, but kept for resilience).
    let wabaId: string | undefined = wabaIdFromGrant;

    if (!wabaId) {
        const meUrl = `${GRAPH_BASE}/me?fields=businesses{id,name,owned_whatsapp_business_accounts{id,name}}`;
        type MeWithWabas = {
            businesses?: {
                data?: Array<{
                    id: string;
                    name?: string;
                    owned_whatsapp_business_accounts?: { data?: Array<{ id: string; name?: string }> };
                }>;
            };
        };
        try {
            const me = await fetchJson<MeWithWabas>(meUrl, { headers: authHeader }, 'waba_discovery');
            for (const biz of me.businesses?.data ?? []) {
                const waba = biz.owned_whatsapp_business_accounts?.data?.[0];
                if (waba?.id) {
                    wabaId = waba.id;
                    break;
                }
            }
        } catch (err) {
            if (err instanceof EmbeddedSignupError) {
                throw new EmbeddedSignupError(
                    'waba_discovery',
                    `Token has no granular WABA target_id and /me/businesses query failed. ` +
                        `Granted scopes: [${[...grantedScopeNames].join(', ') || 'none'}]. ` +
                        `Underlying error: ${err.details}`,
                );
            }
            throw err;
        }
    }

    if (!wabaId) {
        throw new EmbeddedSignupError(
            'waba_discovery',
            'No WhatsApp Business Account found in token grant or owned businesses.',
        );
    }

    // Step 3 — get phone number(s)
    const phoneUrl = `${GRAPH_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`;
    const phones = await fetchJson<PhoneNumbersResponse>(phoneUrl, { headers: authHeader }, 'phone_discovery');
    const phone = phones.data?.[0];
    if (!phone?.id) {
        throw new EmbeddedSignupError('phone_discovery', 'WABA has no phone numbers registered');
    }

    // Step 4 — subscribe our app to the WABA so inbound webhooks fire.
    // Meta returns { success: true } on a clean subscribe.
    const subscribeUrl = `${GRAPH_BASE}/${wabaId}/subscribed_apps`;
    await fetchJson<{ success?: boolean }>(
        subscribeUrl,
        { method: 'POST', headers: authHeader },
        'subscribe_app',
    );

    // Step 5 — register the phone number for Cloud API messaging.
    // Without this, Meta returns (#133010) "Account not registered" on every send.
    // The PIN doubles as the two-step verification code; any 6 digits work on
    // a fresh number without 2SV. Numbers already registered surface a 200 with
    // success=true (Meta is idempotent here), so re-running is safe.
    const registerUrl = `${GRAPH_BASE}/${phone.id}/register`;
    await fetchJson<{ success?: boolean }>(
        registerUrl,
        {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', pin: '123456' }),
        },
        'register_number',
    );

    return {
        accessToken: token.access_token,
        wabaId,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        verifiedName: phone.verified_name,
        tokenExpiresAt: expiresAt,
    };
}

// Re-export the response shape for tests.
export type { OwnedWabaListResponse, PhoneNumbersResponse, MeWithBusinessesResponse };
