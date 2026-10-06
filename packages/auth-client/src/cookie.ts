/**
 * The presence cookie that lets Next.js Edge middleware redirect unauthenticated
 * requests before rendering a protected page. It carries the same access token
 * as storage; middleware only checks it exists, the API still verifies the JWT.
 */
export interface AccessTokenCookieConfig {
    name: string;
    /** Should match the API's access-token TTL. */
    maxAgeSeconds: number;
}

export const DEFAULT_ACCESS_TOKEN_COOKIE: AccessTokenCookieConfig = { name: 'accessToken', maxAgeSeconds: 900 };

export function accessTokenCookieString(cfg: AccessTokenCookieConfig, token: string, secure: boolean): string {
    return `${cfg.name}=${encodeURIComponent(token)}; path=/; max-age=${cfg.maxAgeSeconds}; samesite=lax${secure ? '; secure' : ''}`;
}

export function clearAccessTokenCookieString(cfg: AccessTokenCookieConfig): string {
    return `${cfg.name}=; path=/; max-age=0; samesite=lax`;
}
