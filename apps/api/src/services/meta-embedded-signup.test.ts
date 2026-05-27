import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { completeEmbeddedSignup, EmbeddedSignupError } from './meta-embedded-signup';

// The service reads config at call-time; the test env defaults from
// src/config/index.ts cover JWT/encryption but not WhatsApp app id/secret.
// Set them BEFORE importing-via-test-time so the guard inside the service
// doesn't short-circuit on the config step.
beforeEach(() => {
    process.env.WHATSAPP_APP_ID = 'test-app-id';
    process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
    process.env.WHATSAPP_REDIRECT_URI = 'http://localhost:3000/whatsapp';
});

afterEach(() => {
    vi.restoreAllMocks();
});

function mockFetchSequence(responses: Array<Response | Error>) {
    let i = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const r = responses[i++];
        if (!r) throw new Error(`unexpected extra fetch call #${i}`);
        if (r instanceof Error) throw r;
        return r;
    });
}

describe('completeEmbeddedSignup — happy path', () => {
    it('runs five Meta calls and returns the resolved IDs (granular WABA path)', async () => {
        const fetchSpy = mockFetchSequence([
            new Response(JSON.stringify({ access_token: 'EAAG...token', expires_in: 60 * 60 * 24 * 60 }), { status: 200 }),
            // debug_token — supplies granular_scopes with the WABA target_id
            // so we skip the /me/businesses query entirely.
            new Response(
                JSON.stringify({
                    data: {
                        granular_scopes: [
                            { scope: 'whatsapp_business_management', target_ids: ['waba-99'] },
                            { scope: 'whatsapp_business_messaging', target_ids: ['waba-99'] },
                        ],
                    },
                }),
                { status: 200 },
            ),
            new Response(
                JSON.stringify({
                    data: [
                        { id: 'pn-77', display_phone_number: '+1 555 0100', verified_name: 'Acme Co' },
                    ],
                }),
                { status: 200 },
            ),
            // subscribed_apps
            new Response(JSON.stringify({ success: true }), { status: 200 }),
            // register
            new Response(JSON.stringify({ success: true }), { status: 200 }),
        ]);

        // Re-import the service so it re-reads our env. The module is cached
        // across tests, but the function reads `config` which itself reads
        // process.env at module load. In practice for these tests, the
        // beforeEach sets env early enough.
        const { completeEmbeddedSignup } = await import('./meta-embedded-signup.js');
        const result = await completeEmbeddedSignup('test-code');

        expect(result.accessToken).toBe('EAAG...token');
        expect(result.wabaId).toBe('waba-99');
        expect(result.phoneNumberId).toBe('pn-77');
        expect(result.displayPhoneNumber).toBe('+1 555 0100');
        expect(result.verifiedName).toBe('Acme Co');
        expect(result.tokenExpiresAt).toBeInstanceOf(Date);
        expect(fetchSpy).toHaveBeenCalledTimes(5);

        // Step 1 — token exchange URL contains the expected query params.
        const tokenCall = fetchSpy.mock.calls[0][0] as string;
        expect(tokenCall).toContain('/oauth/access_token');
        expect(tokenCall).toContain('client_id=test-app-id');
        expect(tokenCall).toContain('client_secret=test-app-secret');
        expect(tokenCall).toContain('code=test-code');

        // Step 1b — debug_token inspects scopes and returns the WABA target_id.
        const debugCall = fetchSpy.mock.calls[1][0] as string;
        expect(debugCall).toContain('/debug_token');

        // /me/businesses is NOT called when the granular target_id is present.
        for (const call of fetchSpy.mock.calls) {
            expect(call[0]).not.toContain('/me?fields=businesses');
        }

        // Step 4 — subscribe is a POST (index 3).
        const subscribeCall = fetchSpy.mock.calls[3];
        expect(subscribeCall[0]).toContain('/waba-99/subscribed_apps');
        expect((subscribeCall[1] as RequestInit | undefined)?.method).toBe('POST');

        // Step 5 — register the phone number for Cloud API (index 4).
        const registerCall = fetchSpy.mock.calls[4];
        expect(registerCall[0]).toContain('/pn-77/register');
        const registerInit = registerCall[1] as RequestInit | undefined;
        expect(registerInit?.method).toBe('POST');
        expect(String(registerInit?.body)).toContain('"messaging_product":"whatsapp"');
        expect(String(registerInit?.body)).toMatch(/"pin":"\d{6}"/);
    });
});

describe('completeEmbeddedSignup — error paths', () => {
    it('throws token_exchange error on Meta 400', async () => {
        mockFetchSequence([
            new Response('{"error":{"message":"bad code"}}', { status: 400 }),
        ]);
        await expect(completeEmbeddedSignup('bad')).rejects.toBeInstanceOf(EmbeddedSignupError);
        await expect(completeEmbeddedSignup('bad')).rejects.toMatchObject({
            step: 'token_exchange',
        });
    });

    it('throws waba_discovery error when no business owns a WABA (fallback path)', async () => {
        // debug_token returns scopes but NO target_ids → fallback to /me/businesses,
        // which then has no WABA → final "no WABA found" error.
        mockFetchSequence([
            new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
            new Response(JSON.stringify({ data: { scopes: ['public_profile'] } }), { status: 200 }),
            new Response(
                JSON.stringify({ businesses: { data: [{ id: 'biz1' }] } }),
                { status: 200 },
            ),
        ]);
        await expect(completeEmbeddedSignup('code')).rejects.toMatchObject({
            step: 'waba_discovery',
        });
    });

    it('throws phone_discovery error when WABA has zero numbers', async () => {
        mockFetchSequence([
            new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
            new Response(
                JSON.stringify({
                    data: {
                        granular_scopes: [
                            { scope: 'whatsapp_business_management', target_ids: ['waba1'] },
                        ],
                    },
                }),
                { status: 200 },
            ),
            new Response(JSON.stringify({ data: [] }), { status: 200 }),
        ]);
        await expect(completeEmbeddedSignup('code')).rejects.toMatchObject({
            step: 'phone_discovery',
        });
    });

    it('throws subscribe_app error when Meta refuses the subscription', async () => {
        mockFetchSequence([
            new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
            new Response(
                JSON.stringify({
                    data: {
                        granular_scopes: [
                            { scope: 'whatsapp_business_management', target_ids: ['waba1'] },
                        ],
                    },
                }),
                { status: 200 },
            ),
            new Response(
                JSON.stringify({
                    data: [{ id: 'pn1', display_phone_number: '+1', verified_name: 'X' }],
                }),
                { status: 200 },
            ),
            new Response('subscribe rejected', { status: 403 }),
        ]);
        await expect(completeEmbeddedSignup('code')).rejects.toMatchObject({
            step: 'subscribe_app',
        });
    });

    it('surfaces network errors with the step that was running', async () => {
        mockFetchSequence([new Error('connection reset')]);
        await expect(completeEmbeddedSignup('code')).rejects.toMatchObject({
            step: 'token_exchange',
            message: expect.stringContaining('network_error'),
        });
    });
});
