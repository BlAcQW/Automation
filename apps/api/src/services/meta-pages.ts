/**
 * Connecting a tenant's Facebook Page and Instagram professional account.
 *
 * Unlike WhatsApp, this needs no payment method and costs nothing per message:
 * Meta bills neither Messenger nor Instagram DMs. For a business that cannot
 * put a card on file — which, with Mobile Money, is most of this market — these
 * are the channels that actually work today.
 *
 * Instagram messaging is delivered through the Facebook Page the professional
 * account is linked to, so one Page access token serves both channels and
 * there is only ever one OAuth journey to complete.
 */

import { config } from '../config/index.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export type PageConnectStep =
    | 'config'
    | 'token_exchange'
    | 'page_discovery'
    | 'subscribe_page';

export class PageConnectError extends Error {
    constructor(public readonly step: PageConnectStep, public readonly details: string) {
        super(`page_connect_${step}: ${details}`);
        this.name = 'PageConnectError';
    }
}

export interface DiscoveredPage {
    pageId: string;
    pageName: string;
    /** Page access token — long-lived, and what signs every send. */
    pageToken: string;
    instagramUserId?: string;
    instagramUsername?: string;
}

async function graph<T>(url: string, init: RequestInit | undefined, step: PageConnectStep): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (err) {
        throw new PageConnectError(step, `network_error: ${(err as Error).message}`);
    }
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
        let detail = raw.slice(0, 400);
        try {
            const p = JSON.parse(raw) as { error?: { message?: string; error_user_msg?: string } };
            detail = p.error?.error_user_msg ?? p.error?.message ?? detail;
        } catch {
            /* keep raw */
        }
        throw new PageConnectError(step, `http_${res.status}: ${detail}`);
    }
    try {
        return (raw ? JSON.parse(raw) : {}) as T;
    } catch (err) {
        throw new PageConnectError(step, `invalid_json: ${(err as Error).message}`);
    }
}

/**
 * Exchange the Facebook Login code and list the Pages this person administers,
 * each with its linked Instagram account where one exists.
 *
 * Returns every Page rather than guessing: a salon owner who also administers a
 * friend's Page must choose, and silently taking the first one is how the wrong
 * business ends up wired to someone else's bookings.
 */
export async function discoverPages(code: string, redirectUri?: string): Promise<DiscoveredPage[]> {
    if (!config.whatsapp.appId || !config.whatsapp.appSecret) {
        throw new PageConnectError('config', 'WHATSAPP_APP_ID and WHATSAPP_APP_SECRET must be set');
    }

    const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', config.whatsapp.appId);
    tokenUrl.searchParams.set('client_secret', config.whatsapp.appSecret);
    tokenUrl.searchParams.set('code', code);
    if (redirectUri) tokenUrl.searchParams.set('redirect_uri', redirectUri);

    const token = await graph<{ access_token?: string }>(tokenUrl.toString(), undefined, 'token_exchange');
    if (!token.access_token) {
        throw new PageConnectError('token_exchange', 'response missing access_token');
    }

    const pagesUrl =
        `${GRAPH_BASE}/me/accounts` +
        `?fields=id,name,access_token,instagram_business_account{id,username}` +
        `&limit=50`;

    const pages = await graph<{
        data?: Array<{
            id: string;
            name?: string;
            access_token?: string;
            instagram_business_account?: { id?: string; username?: string };
        }>;
    }>(pagesUrl, { headers: { Authorization: `Bearer ${token.access_token}` } }, 'page_discovery');

    return (pages.data ?? [])
        .filter((p) => p.id && p.access_token)
        .map((p) => ({
            pageId: p.id,
            pageName: p.name ?? 'Untitled Page',
            pageToken: p.access_token as string,
            instagramUserId: p.instagram_business_account?.id,
            instagramUsername: p.instagram_business_account?.username,
        }));
}

/**
 * Subscribe our app to the Page's messaging webhooks.
 *
 * Without this the connection looks healthy and silently receives nothing,
 * which is the worst possible failure mode — so this is never best-effort.
 */
export async function subscribePageToWebhooks(pageId: string, pageToken: string): Promise<void> {
    const url =
        `${GRAPH_BASE}/${pageId}/subscribed_apps` +
        `?subscribed_fields=messages,messaging_postbacks,message_reactions`;
    await graph<{ success?: boolean }>(
        url,
        { method: 'POST', headers: { Authorization: `Bearer ${pageToken}` } },
        'subscribe_page',
    );
}

/** Remove our webhook subscription when a tenant disconnects. */
export async function unsubscribePage(pageId: string, pageToken: string): Promise<void> {
    await graph<{ success?: boolean }>(
        `${GRAPH_BASE}/${pageId}/subscribed_apps`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${pageToken}` } },
        'subscribe_page',
    );
}
