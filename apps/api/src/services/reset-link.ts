/**
 * Where a password-reset link points.
 *
 * By default it is Bookly's own page (`${FRONTEND_URL}/reset-password`). An
 * app that signs organisation users in on another origin (TURBO's console,
 * say) may ask for its own reset page instead, but ONLY if that page is on an
 * origin the API already trusts (`config.corsOrigins`, which includes
 * FRONTEND_URL) and is https (plain http is accepted only for localhost in
 * development and test). Anything else silently falls back to the default:
 * the caller is never told, so the endpoint stays a no-information oracle and
 * a phishing page can never be the target of a genuine Bookly email.
 *
 * The comparison is on the parsed URL's `origin` (scheme + host + port), so
 * lookalike hosts, other ports, embedded credentials and non-http schemes
 * never match.
 */

export interface ResetLinkConfig {
    nodeEnv: 'development' | 'test' | 'production';
    frontendUrl: string;
    allowedOrigins: readonly string[];
}

export type ResolvedResetBase =
    | { base: string; custom: false }
    | { base: string; custom: true; origin: string };

export interface ResetLinkOption {
    label: string;
    origin: string;
    resetUrl: string;
    isDefault: boolean;
}

const MAX_URL_LENGTH = 2048;
const LOCAL_HOSTS = new Set(['localhost']);
const RESET_PATH = '/reset-password';

function parse(raw: string): URL | null {
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

/** May a URL with this scheme and host be a reset page under this config? */
function schemeAllowed(url: URL, nodeEnv: ResetLinkConfig['nodeEnv']): boolean {
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && nodeEnv !== 'production' && LOCAL_HOSTS.has(url.hostname);
}

/** The allowed origins, normalised, keeping only ones a reset page could live on. */
function trustedOrigins(cfg: ResetLinkConfig): string[] {
    const out: string[] = [];
    for (const raw of cfg.allowedOrigins) {
        const u = parse(raw);
        if (!u || !schemeAllowed(u, cfg.nodeEnv)) continue;
        if (!out.includes(u.origin)) out.push(u.origin);
    }
    return out;
}

/** Bookly's own reset page. */
export function defaultResetBase(frontendUrl: string): string {
    const u = parse(frontendUrl) ?? new URL('http://localhost:3000');
    u.pathname = `${u.pathname.replace(/\/+$/, '')}${RESET_PATH}`;
    u.search = '';
    u.hash = '';
    return u.toString();
}

/**
 * Decide the reset page for a request. `requested` is whatever the client
 * sent (any type): only a string that passes every check is used.
 */
export function resolveResetBase(requested: unknown, cfg: ResetLinkConfig): ResolvedResetBase {
    const fallback: ResolvedResetBase = { base: defaultResetBase(cfg.frontendUrl), custom: false };
    if (typeof requested !== 'string' || requested.length === 0 || requested.length > MAX_URL_LENGTH) return fallback;

    const url = parse(requested);
    if (!url) return fallback;
    if (url.username || url.password) return fallback;
    if (!schemeAllowed(url, cfg.nodeEnv)) return fallback;
    if (!trustedOrigins(cfg).includes(url.origin)) return fallback;

    url.search = '';
    url.hash = '';
    return { base: url.toString(), custom: true, origin: url.origin };
}

/** Put the token on the page URL. URL APIs, never string concatenation. */
export function buildResetLink(base: string, token: string): string {
    const url = new URL(base);
    url.searchParams.set('token', token);
    url.hash = '';
    return url.toString();
}

/**
 * The reset pages an admin may pick from when copying a link: Bookly first,
 * then each other trusted origin's `/reset-password`.
 */
export function resetLinkOptions(cfg: ResetLinkConfig): ResetLinkOption[] {
    const bookly = defaultResetBase(cfg.frontendUrl);
    const booklyOrigin = new URL(bookly).origin;
    const options: ResetLinkOption[] = [{ label: 'Bookly', origin: booklyOrigin, resetUrl: bookly, isDefault: true }];
    for (const origin of trustedOrigins(cfg)) {
        if (origin === booklyOrigin) continue;
        options.push({ label: new URL(origin).host, origin, resetUrl: `${origin}${RESET_PATH}`, isDefault: false });
    }
    return options;
}
