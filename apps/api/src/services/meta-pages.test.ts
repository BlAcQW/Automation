import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverPages, PageConnectError } from './meta-pages.js';

// The test env defaults (src/config/index.ts) set WHATSAPP_APP_ID=test-app-id.
const APP_ID = 'test-app-id';

afterEach(() => { vi.restoreAllMocks(); });

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const graphError = (status: number, message: string) =>
    new Response(JSON.stringify({ error: { message } }), { status });

function mockFetchSequence(responses: Response[]) {
    let i = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const r = responses[i++];
        if (!r) throw new Error(`unexpected extra fetch call #${i}`);
        return r;
    });
}

describe('discoverPages', () => {
    it('swaps the login token for a long-lived one and lists Pages with it', async () => {
        // Arrange
        const fetchSpy = mockFetchSequence([
            ok({ access_token: 'long-lived-user-token', token_type: 'bearer', expires_in: 5_184_000 }),
            ok({
                data: [
                    { id: 'pg1', name: 'Bookly Test Clinic', access_token: 'page-tok-1', instagram_business_account: { id: 'ig1', username: 'clinic.gh' } },
                    { id: 'pg2', name: 'Side Page', access_token: 'page-tok-2' },
                    { id: 'pg3', name: 'No token (not an admin)' },
                ],
            }),
        ]);

        // Act
        const pages = await discoverPages('short-lived-user-token');

        // Assert: the exchange is Meta's fb_exchange_token grant for our own app.
        const exchange = new URL(String(fetchSpy.mock.calls[0][0]));
        expect(exchange.pathname).toMatch(/\/oauth\/access_token$/);
        expect(exchange.searchParams.get('grant_type')).toBe('fb_exchange_token');
        expect(exchange.searchParams.get('client_id')).toBe(APP_ID);
        expect(exchange.searchParams.get('fb_exchange_token')).toBe('short-lived-user-token');
        expect(exchange.searchParams.has('code')).toBe(false);

        // Assert: Pages are read with the long-lived token, so their tokens do not expire.
        const [pagesUrl, pagesInit] = fetchSpy.mock.calls[1];
        expect(String(pagesUrl)).toContain('/me/accounts');
        expect((pagesInit as RequestInit).headers).toEqual({ Authorization: 'Bearer long-lived-user-token' });

        expect(pages).toEqual([
            { pageId: 'pg1', pageName: 'Bookly Test Clinic', pageToken: 'page-tok-1', instagramUserId: 'ig1', instagramUsername: 'clinic.gh' },
            { pageId: 'pg2', pageName: 'Side Page', pageToken: 'page-tok-2', instagramUserId: undefined, instagramUsername: undefined },
        ]);
    });

    it('fails at token_exchange when Meta refuses the login token', async () => {
        // Arrange: e.g. a token issued to a different app, or an expired one.
        mockFetchSequence([graphError(400, 'Error validating access token')]);

        // Act
        const result = discoverPages('someone-elses-token');

        // Assert
        await expect(result).rejects.toBeInstanceOf(PageConnectError);
        await expect(result).rejects.toMatchObject({ step: 'token_exchange' });
    });

    it('fails at token_exchange when Meta returns no token', async () => {
        // Arrange
        mockFetchSequence([ok({})]);

        // Act
        const result = discoverPages('short-lived-user-token');

        // Assert
        await expect(result).rejects.toMatchObject({ step: 'token_exchange', details: 'response missing access_token' });
    });
});
