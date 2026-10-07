import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    chooseWaba,
    choosePhone,
    completeEmbeddedSignup,
    EmbeddedSignupError,
    grantedWabaIds,
} from './meta-embedded-signup.js';

// The test env defaults (src/config/index.ts) set WHATSAPP_APP_ID=test-app-id.
const APP_ID = 'test-app-id';

afterEach(() => { vi.restoreAllMocks(); });

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function mockFetchSequence(responses: Array<Response | Error>) {
    let i = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const r = responses[i++];
        if (!r) throw new Error(`unexpected extra fetch call #${i}`);
        if (r instanceof Error) throw r;
        return r;
    });
}

const debug = (over: Record<string, unknown> = {}) => ok({
    data: {
        app_id: APP_ID, is_valid: true, expires_at: 0,
        granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['waba-99'] },
            { scope: 'whatsapp_business_messaging', target_ids: ['waba-99'] },
        ],
        ...over,
    },
});
const phones = (list: Array<{ id: string }>) => ok({ data: list.map((p) => ({ display_phone_number: '+1 555 0100', verified_name: 'Acme Co', ...p })) });

describe('completeEmbeddedSignup — happy path', () => {
    it('exchanges by POST form, checks the token, uses the granted WABA and registers with a random PIN', async () => {
        const fetchSpy = mockFetchSequence([
            ok({ access_token: 'EAAGtoken1234567890', expires_in: 60 * 60 * 24 * 60 }),
            debug(),
            phones([{ id: 'pn-77' }]),
            ok({ success: true }),
            ok({ success: true }),
        ]);
        const result = await completeEmbeddedSignup('test-code');

        expect(result).toMatchObject({ accessToken: 'EAAGtoken1234567890', wabaId: 'waba-99', phoneNumberId: 'pn-77', displayPhoneNumber: '+1 555 0100', verifiedName: 'Acme Co' });
        expect(result.tokenExpiresAt).toBeInstanceOf(Date);
        expect(result.registrationPin).toMatch(/^\d{6}$/);

        // Secrets travel in POST bodies, never URLs.
        const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(tokenUrl).toMatch(/\/oauth\/access_token$/);
        expect(tokenInit.method).toBe('POST');
        expect(String(tokenInit.body)).toContain('client_secret=');
        expect(String(tokenInit.body)).toContain('code=test-code');
        const [debugUrl, debugInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
        expect(debugUrl).toMatch(/\/debug_token$/);
        expect(String(debugInit.body)).toContain('input_token=EAAGtoken1234567890');
        for (const [url] of fetchSpy.mock.calls) {
            expect(String(url)).not.toMatch(/client_secret|input_token|access_token=/);
            expect(String(url)).not.toContain('/me?fields=businesses');
        }

        const [registerUrl, registerInit] = fetchSpy.mock.calls[4] as [string, RequestInit];
        expect(registerUrl).toContain('/pn-77/register');
        expect(String(registerInit.body)).toContain(`"pin":"${result.registrationPin}"`);
    });

    it('uses the session hint when it is among the granted WABAs and that WABA has the number', async () => {
        mockFetchSequence([
            ok({ access_token: 'tok' }),
            debug({ granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['w1', 'w2'] }] }),
            phones([{ id: 'p1' }, { id: 'p2' }]),
            ok({ success: true }),
            ok({ success: true }),
        ]);
        const r = await completeEmbeddedSignup('c', undefined, { wabaId: 'w2', phoneNumberId: 'p2' });
        expect([r.wabaId, r.phoneNumberId]).toEqual(['w2', 'p2']);
    });

    it('two signups never share a PIN by construction (random per number)', async () => {
        const pins = new Set<string>();
        for (let i = 0; i < 5; i += 1) {
            mockFetchSequence([ok({ access_token: 'tok' }), debug(), phones([{ id: 'p' }]), ok({}), ok({})]);
            pins.add((await completeEmbeddedSignup('c')).registrationPin);
            vi.restoreAllMocks();
        }
        expect(pins.size).toBeGreaterThan(1);
    });
});

describe('completeEmbeddedSignup — fails closed', () => {
    it('token_exchange error on Meta 400', async () => {
        mockFetchSequence([new Response('{"error":{"message":"bad code"}}', { status: 400 })]);
        await expect(completeEmbeddedSignup('bad')).rejects.toMatchObject({ step: 'token_exchange' });
    });

    it('debug_token failing is an error (no "skip the check" fallback)', async () => {
        mockFetchSequence([ok({ access_token: 'tok' }), new Response('{}', { status: 500 })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'token_check' });
    });

    it('a token issued to another app, or an invalid one, is refused', async () => {
        mockFetchSequence([ok({ access_token: 'tok' }), debug({ app_id: 'someone-else' })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'token_check' });
        vi.restoreAllMocks();
        mockFetchSequence([ok({ access_token: 'tok' }), debug({ is_valid: false })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'token_check' });
    });

    it('a hinted WABA that was not granted is refused before any WABA call', async () => {
        const spy = mockFetchSequence([ok({ access_token: 'tok' }), debug()]);
        await expect(completeEmbeddedSignup('c', undefined, { wabaId: 'someone-elses-waba' })).rejects.toMatchObject({ step: 'waba_discovery' });
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('no granted WABA is an error (no /me/businesses fallback)', async () => {
        const spy = mockFetchSequence([ok({ access_token: 'tok' }), debug({ granular_scopes: [] })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'waba_discovery' });
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('a hinted number not on that WABA is refused; several numbers and no hint is refused', async () => {
        mockFetchSequence([ok({ access_token: 'tok' }), debug(), phones([{ id: 'p1' }])]);
        await expect(completeEmbeddedSignup('c', undefined, { phoneNumberId: 'p-other' })).rejects.toMatchObject({ step: 'phone_discovery' });
        vi.restoreAllMocks();
        mockFetchSequence([ok({ access_token: 'tok' }), debug(), phones([{ id: 'p1' }, { id: 'p2' }])]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'phone_discovery' });
    });

    it('subscribe_app error when Meta refuses the subscription', async () => {
        mockFetchSequence([ok({ access_token: 'tok' }), debug(), phones([{ id: 'p1' }]), new Response('rejected', { status: 403 })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'subscribe_app' });
    });

    it('network errors carry the step that was running', async () => {
        mockFetchSequence([new Error('connection reset')]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'token_exchange', message: expect.stringContaining('network_error') });
    });

    it('error details are scrubbed of token-shaped text', () => {
        const e = new EmbeddedSignupError('token_check', 'http_400: bad token EAAGabcdefghijklmnop12345 for access_token=secretvalue');
        expect(e.details).not.toMatch(/EAAGabcdef|secretvalue/);
    });
});

describe('pure choosers', () => {
    it('grantedWabaIds unions the WhatsApp scopes only', () => {
        expect(grantedWabaIds({ granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['a'] },
            { scope: 'whatsapp_business_messaging', target_ids: ['a', 'b'] },
            { scope: 'pages_show_list', target_ids: ['page'] },
        ] })).toEqual(['a', 'b']);
    });
    it('chooseWaba never picks "the first" of several', () => {
        expect(chooseWaba(['a'], undefined)).toBe('a');
        expect(() => chooseWaba(['a', 'b'], undefined)).toThrow(EmbeddedSignupError);
        expect(chooseWaba(['a', 'b'], 'b')).toBe('b');
    });
    it('choosePhone never picks "the first" of several', () => {
        expect(() => choosePhone([{ id: '1' }, { id: '2' }], undefined)).toThrow(EmbeddedSignupError);
        expect(choosePhone([{ id: '1' }, { id: '2' }], '2')).toEqual({ id: '2' });
    });
});

describe('completeEmbeddedSignup — number already has a two-step PIN (#133005)', () => {
    const pinMismatch = () =>
        new Response(
            JSON.stringify({ error: { message: '(#133005) Two step verification PIN Mismatch', type: 'OAuthException', code: 133005, fbtrace_id: 'x' } }),
            { status: 400 },
        );
    const start = () => [ok({ access_token: 'EAAGtoken1234567890' }), debug(), phones([{ id: 'pn-77' }]), ok({ success: true })];

    it('sets our new PIN as the two-step code (form POST, business token), then registers again', async () => {
        const spy = mockFetchSequence([...start(), pinMismatch(), ok({ success: true }), ok({ success: true })]);
        const result = await completeEmbeddedSignup('c');

        expect(spy).toHaveBeenCalledTimes(7);
        const [setUrl, setInit] = spy.mock.calls[5] as [string, RequestInit];
        expect(setUrl).toMatch(/\/pn-77$/);
        expect(setInit.method).toBe('POST');
        expect(String(setInit.body)).toBe(`pin=${result.registrationPin}`);
        const setHeaders = setInit.headers as Record<string, string>;
        expect(setHeaders['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(setHeaders.Authorization).toBe('Bearer EAAGtoken1234567890');

        // The retry registers with the same PIN that was just set (and is stored).
        const [retryUrl, retryInit] = spy.mock.calls[6] as [string, RequestInit];
        expect(retryUrl).toContain('/pn-77/register');
        expect(String(retryInit.body)).toContain(`"pin":"${result.registrationPin}"`);
        expect(result.registrationPin).toMatch(/^\d{6}$/);
    });

    it('fails with step set_two_step_pin when Meta will not set the PIN', async () => {
        mockFetchSequence([...start(), pinMismatch(), new Response('{"error":{"message":"Permissions error","code":10}}', { status: 403 })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'set_two_step_pin' });
    });

    it('fails with step set_two_step_pin when the retry still reports a PIN mismatch (retries once only)', async () => {
        const spy = mockFetchSequence([...start(), pinMismatch(), ok({ success: true }), pinMismatch()]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'set_two_step_pin' });
        expect(spy).toHaveBeenCalledTimes(7);
    });

    it('other register errors are unchanged: no PIN reset, step register_number', async () => {
        const spy = mockFetchSequence([...start(), new Response('{"error":{"message":"(#133010) Account not registered","code":133010}}', { status: 400 })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'register_number' });
        expect(spy).toHaveBeenCalledTimes(5);
    });

    it('a retry that fails for another reason reports register_number', async () => {
        mockFetchSequence([...start(), pinMismatch(), ok({ success: true }), new Response('{"error":{"message":"Service unavailable","code":2}}', { status: 503 })]);
        await expect(completeEmbeddedSignup('c')).rejects.toMatchObject({ step: 'register_number' });
    });
});
