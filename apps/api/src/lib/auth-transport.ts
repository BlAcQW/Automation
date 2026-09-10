/**
 * Pure helpers for the web-vs-mobile auth transport, extracted so they can be
 * unit-tested without a Fastify request. See routes/auth/index.ts for usage.
 */

export function isMobileClient(headers: Record<string, unknown>): boolean {
    const header = headers['x-client'];
    const value = Array.isArray(header) ? header[0] : header;
    return typeof value === 'string' && value.toLowerCase() === 'mobile';
}

// Web sends the refresh token as an HTTP-only cookie; mobile sends it in the
// JSON body. Returns undefined when neither is present.
export function extractRefreshToken(input: {
    cookies?: Record<string, string | undefined>;
    body?: unknown;
}): string | undefined {
    const cookieToken = input.cookies?.refreshToken;
    if (cookieToken) return cookieToken;

    const body = input.body as { refreshToken?: unknown } | undefined;
    if (body && typeof body.refreshToken === 'string' && body.refreshToken.length > 0) {
        return body.refreshToken;
    }

    return undefined;
}
