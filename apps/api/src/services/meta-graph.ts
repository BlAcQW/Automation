/**
 * The Graph API version used by Bookly's WhatsApp onboarding and health code
 * (Embedded Signup completion, hosted-number onboarding, health checks) and
 * handed to consoles as the FB JS SDK version for Embedded Signup v4.
 *
 * Meta's Embedded Signup v4 implementation guide uses v25.0 (checked
 * 2026-10-06). Bump here, in one place, when Meta deprecates it.
 */
export const META_GRAPH_VERSION = 'v25.0';
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/**
 * Make Meta error text safe to log or store: strip anything token-shaped
 * (Meta user/business tokens start with "EAA"; app tokens are "id|secret";
 * access_token/client_secret/code query params) and bound the length. Meta
 * does not normally echo credentials, but a log line is the wrong place to
 * find out it started to.
 */
export function scrubMetaText(text: string, max = 300): string {
    return text
        .replace(/\bEAA[A-Za-z0-9]{10,}/g, '[token]')
        .replace(/\b\d{6,}\|[A-Za-z0-9_-]{10,}/g, '[app-token]')
        .replace(/((?:access_token|input_token|client_secret|code|fb_exchange_token)=)[^&\s"']+/gi, '$1[redacted]')
        .replace(/\b[A-Za-z0-9_-]{60,}\b/g, '[redacted]')
        .slice(0, max);
}

/** application/x-www-form-urlencoded body, so secrets never sit in a URL (logs, proxies). */
export function formBody(params: Record<string, string>): { body: string; headers: Record<string, string> } {
    return {
        body: new URLSearchParams(params).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    };
}
