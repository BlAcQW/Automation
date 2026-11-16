import { describe, expect, it, vi } from 'vitest';
import {
    FACEBOOK_GRAPH_VERSION,
    FACEBOOK_SDK_ID,
    FACEBOOK_SDK_SRC,
    createFacebookSdkLoader,
    facebookLogin,
    type FacebookSdk,
    type FacebookSdkEnv,
} from './facebook-sdk';

interface FakeScript {
    id: string;
    src: string;
    async: boolean;
    defer: boolean;
    crossOrigin: string | null;
    onerror: (() => void) | null;
    removed: boolean;
    remove(): void;
}

function fakeEnv(opts: { fbAlreadyLoaded?: boolean } = {}) {
    const init = vi.fn();
    const fb = { init, login: vi.fn() };
    const scripts: FakeScript[] = [];
    const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const win: FacebookSdkEnv['win'] = opts.fbAlreadyLoaded ? { FB: fb } : {};

    const env: FacebookSdkEnv = {
        win,
        doc: {
            getElementById: (id) => scripts.find((s) => s.id === id && !s.removed) ?? null,
            createElement: () => {
                const script: FakeScript = {
                    id: '', src: '', async: false, defer: false, crossOrigin: null, onerror: null, removed: false,
                    remove() { this.removed = true; },
                };
                return script;
            },
            appendScript: (script) => { scripts.push(script as FakeScript); },
        },
        setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
        clearTimer: (t) => { (t as { cleared: boolean }).cleared = true; },
    };

    /** What Meta's sdk.js does once it has downloaded. */
    const sdkArrives = () => { win.FB = fb; win.fbAsyncInit?.(); };
    const fireTimeouts = () => timers.filter((t) => !t.cleared).forEach((t) => t.fn());

    return { env, fb, init, scripts, timers, sdkArrives, fireTimeouts };
}

describe('createFacebookSdkLoader', () => {
    it('adds Meta’s SDK script once and resolves with an initialised FB when it arrives', async () => {
        // Arrange
        const { env, fb, init, scripts, sdkArrives } = fakeEnv();
        const load = createFacebookSdkLoader(env);

        // Act
        const first = load('app-123');
        const second = load('app-123');
        sdkArrives();

        // Assert
        await expect(first).resolves.toBe(fb);
        await expect(second).resolves.toBe(fb);
        expect(scripts).toHaveLength(1);
        expect(scripts[0]).toMatchObject({ id: FACEBOOK_SDK_ID, src: FACEBOOK_SDK_SRC, async: true, crossOrigin: 'anonymous' });
        expect(init).toHaveBeenCalledTimes(1);
        expect(init).toHaveBeenCalledWith({ appId: 'app-123', cookie: true, xfbml: true, version: FACEBOOK_GRAPH_VERSION });
    });

    it('reuses an SDK another page already loaded instead of waiting for a new script', async () => {
        // Arrange: the person opened the WhatsApp page first, so FB is already on the window.
        const { env, fb, init, scripts } = fakeEnv({ fbAlreadyLoaded: true });
        const load = createFacebookSdkLoader(env);

        // Act
        const sdk = await load('app-123');
        await load('app-123');

        // Assert
        expect(sdk).toBe(fb);
        expect(scripts).toHaveLength(0);
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('rejects when the script is blocked, and a retry adds a fresh script', async () => {
        // Arrange
        const { env, fb, scripts, sdkArrives } = fakeEnv();
        const load = createFacebookSdkLoader(env);

        // Act
        const blocked = load('app-123');
        scripts[0].onerror?.();

        // Assert
        await expect(blocked).rejects.toThrow('blocked');

        // Act: try again
        const retry = load('app-123');
        sdkArrives();

        // Assert
        await expect(retry).resolves.toBe(fb);
        expect(scripts).toHaveLength(2);
        expect(scripts[0].removed).toBe(true);
    });

    it('rejects when Meta’s SDK never arrives (some blockers fail silently)', async () => {
        // Arrange
        const { env, timers, fireTimeouts } = fakeEnv();
        const load = createFacebookSdkLoader(env);

        // Act
        const pending = load('app-123', 5_000);
        fireTimeouts();

        // Assert
        await expect(pending).rejects.toThrow('timeout');
        expect(timers[0].ms).toBe(5_000);
    });

    it('stops the timeout once the SDK has arrived', async () => {
        // Arrange
        const { env, timers, sdkArrives } = fakeEnv();
        const load = createFacebookSdkLoader(env);

        // Act
        const pending = load('app-123');
        sdkArrives();
        await pending;

        // Assert
        expect(timers[0].cleared).toBe(true);
    });
});

/**
 * A stand-in for Meta's SDK that applies the same check as the real FB.login:
 * anything but a plain function is rejected with "Expression is of type
 * asyncfunction, not function", and no popup opens.
 */
function strictSdk() {
    let callback: ((response: unknown) => void) | null = null;
    const login = vi.fn((cb: (response: unknown) => void, _options: Record<string, unknown>) => {
        const type = Object.prototype.toString.call(cb).slice(8, -1).toLowerCase();
        if (type !== 'function') throw new Error(`Expression is of type ${type}, not function`);
        callback = cb;
    });
    const sdk: FacebookSdk = { init: vi.fn(), login };
    const personFinishes = (response: unknown) => callback?.(response);
    return { sdk, login, personFinishes };
}

describe('facebookLogin', () => {
    it('opens Meta’s login straight away with a plain callback, and resolves with the response', async () => {
        // Arrange
        const { sdk, login, personFinishes } = strictSdk();
        const options = { response_type: 'code', scope: 'pages_show_list' };

        // Act
        const result = facebookLogin(sdk, options);

        // Assert: called synchronously, so the popup stays inside the click.
        expect(login).toHaveBeenCalledTimes(1);
        expect(login.mock.calls[0][1]).toBe(options);

        // Act
        personFinishes({ status: 'connected', authResponse: { code: 'abc' } });

        // Assert
        await expect(result).resolves.toEqual({ status: 'connected', authResponse: { code: 'abc' } });
    });

    it('rejects instead of hanging when Meta’s SDK refuses to open the login', async () => {
        // Arrange
        const sdk: FacebookSdk = {
            init: vi.fn(),
            login: () => { throw new Error('Expression is of type asyncfunction, not function'); },
        };

        // Act
        const result = facebookLogin(sdk, {});

        // Assert
        await expect(result).rejects.toThrow('asyncfunction');
    });
});
