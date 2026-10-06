/**
 * Small, read-mostly Graph API calls about a connected WhatsApp number: its
 * health fields, which apps are subscribed to its WABA, whether a token is
 * still valid, and unsubscribing our app on disconnect.
 *
 * TOKENS: every function takes the token as an argument and never logs it or
 * puts it in an error. A failure carries Meta's error code/type/message only,
 * which never contain the token.
 */

import { META_GRAPH_BASE, formBody, scrubMetaText } from './meta-graph.js';
import { config } from '../config/index.js';

const GRAPH_BASE = META_GRAPH_BASE;

/** Fields read from GET /{phone-number-id}. All are documented phone-number fields. */
export const PHONE_HEALTH_FIELDS = [
    'display_phone_number',
    'verified_name',
    'name_status',
    'quality_rating',
    'messaging_limit_tier',
    'status',
    'code_verification_status',
] as const;

export interface PhoneHealth {
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    nameStatus: string | null;
    qualityRating: string | null;
    messagingLimitTier: string | null;
    status: string | null;
    codeVerificationStatus: string | null;
}

export class GraphError extends Error {
    constructor(
        readonly httpStatus: number,
        /** Meta's numeric error code, e.g. 190 = OAuthException (token invalid/expired). */
        readonly graphCode: number | null,
        readonly graphSubcode: number | null,
        readonly graphType: string | null,
        detail: string,
    ) {
        super(scrubMetaText(detail));
        this.name = 'GraphError';
    }

    /** Token invalid, expired, revoked or lacking permission for this object. */
    get isAuthFailure(): boolean {
        return this.graphCode === 190 || this.graphType === 'OAuthException' || this.httpStatus === 401;
    }
}

async function graph<T>(path: string, init: RequestInit, token: string): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`${GRAPH_BASE}${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
        });
    } catch (err) {
        throw new GraphError(0, null, null, null, `network_error: ${(err as Error).message}`);
    }
    const raw = await response.text().catch(() => '');
    if (!response.ok) {
        let code: number | null = null;
        let subcode: number | null = null;
        let type: string | null = null;
        let detail = `http_${response.status}`;
        try {
            const parsed = JSON.parse(raw) as {
                error?: { message?: string; code?: number; error_subcode?: number; type?: string };
            };
            code = parsed.error?.code ?? null;
            subcode = parsed.error?.error_subcode ?? null;
            type = parsed.error?.type ?? null;
            if (parsed.error?.message) detail = `${detail}: ${parsed.error.message.slice(0, 300)}`;
        } catch {
            /* not JSON: keep the status only, never echo an unknown body */
        }
        throw new GraphError(response.status, code, subcode, type, detail);
    }
    try {
        return (raw ? JSON.parse(raw) : {}) as T;
    } catch {
        throw new GraphError(response.status, null, null, null, 'invalid_json');
    }
}

export async function fetchPhoneHealth(phoneNumberId: string, token: string): Promise<PhoneHealth> {
    const r = await graph<Record<string, unknown>>(
        `/${encodeURIComponent(phoneNumberId)}?fields=${PHONE_HEALTH_FIELDS.join(',')}`,
        { method: 'GET' },
        token,
    );
    const str = (k: string): string | null => (typeof r[k] === 'string' && r[k] ? (r[k] as string) : null);
    return {
        displayPhoneNumber: str('display_phone_number'),
        verifiedName: str('verified_name'),
        nameStatus: str('name_status'),
        qualityRating: str('quality_rating'),
        messagingLimitTier: str('messaging_limit_tier'),
        status: str('status'),
        codeVerificationStatus: str('code_verification_status'),
    };
}

/**
 * Is OUR app subscribed to this WABA (i.e. will inbound webhooks arrive)?
 * Returns null when it cannot be decided (our app id is not configured).
 */
export async function isAppSubscribed(wabaId: string, token: string): Promise<boolean | null> {
    const appId = config.whatsapp.appId;
    if (!appId) return null;
    const r = await graph<{ data?: Array<{ whatsapp_business_api_data?: { id?: string }; id?: string }> }>(
        `/${encodeURIComponent(wabaId)}/subscribed_apps`,
        { method: 'GET' },
        token,
    );
    return (r.data ?? []).some((a) => a.whatsapp_business_api_data?.id === appId || a.id === appId);
}

export interface TokenInfo {
    isValid: boolean;
    /** The app the token was issued to. */
    appId: string | null;
    /** null = never expires (or Meta did not say). */
    expiresAt: Date | null;
    /** WABA ids from the WhatsApp granular scopes. */
    wabaIds: string[];
}

/**
 * Inspect a tenant token with the app token, as a POST form (method=GET) so
 * neither token sits in a URL. Returns null when the app credentials are not
 * configured, so the caller can decide whether that is fatal.
 */
export async function inspectToken(token: string): Promise<TokenInfo | null> {
    const { appId, appSecret } = config.whatsapp;
    if (!appId || !appSecret) return null;
    const form = formBody({ method: 'GET', input_token: token });
    const r = await graph<{ data?: { is_valid?: boolean; app_id?: string; expires_at?: number; granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } }>(
        '/debug_token',
        { method: 'POST', body: form.body, headers: form.headers },
        `${appId}|${appSecret}`,
    );
    const exp = r.data?.expires_at;
    const wabaIds = new Set<string>();
    for (const g of r.data?.granular_scopes ?? []) {
        if (g.scope === 'whatsapp_business_management' || g.scope === 'whatsapp_business_messaging') {
            for (const id of g.target_ids ?? []) wabaIds.add(id);
        }
    }
    return {
        isValid: r.data?.is_valid === true,
        appId: r.data?.app_id ?? null,
        // 0 means "never" for long-lived system-user / business tokens.
        expiresAt: typeof exp === 'number' && exp > 0 ? new Date(exp * 1000) : null,
        wabaIds: [...wabaIds],
    };
}

/** The phone-number ids on a WABA, read with a token that can see it. */
export async function listWabaPhoneIds(wabaId: string, token: string): Promise<string[]> {
    const r = await graph<{ data?: Array<{ id?: string }> }>(
        `/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`,
        { method: 'GET' },
        token,
    );
    return (r.data ?? []).map((p) => p.id).filter((id): id is string => typeof id === 'string');
}

/** Stop webhooks for this WABA reaching our app. */
export async function unsubscribeApp(wabaId: string, token: string): Promise<void> {
    await graph<{ success?: boolean }>(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'DELETE' }, token);
}
