/**
 * Loads Meta's JavaScript SDK once per tab and initialises it with Bookly's app.
 *
 * Shared by the WhatsApp and Channels pages. Before this existed only the
 * WhatsApp page loaded the SDK, so opening Channels directly (or refreshing it)
 * left `window.FB` undefined and every "Connect" click reported a blocked
 * ad-blocker that was never there.
 */

export const FACEBOOK_SDK_ID = 'facebook-jssdk';
export const FACEBOOK_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
/** Embedded Signup v4 (Meta's implementation guide uses v25.0). */
export const FACEBOOK_GRAPH_VERSION = 'v25.0';
/** Some blockers swallow the request without firing `onerror`; give up after this. */
export const FACEBOOK_SDK_TIMEOUT_MS = 15_000;

/** The slice of Meta's SDK that Bookly calls. */
export interface FacebookSdk {
    init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(callback: (response: unknown) => void, options: Record<string, unknown>): void;
}

export interface SdkScript {
    id: string;
    src: string;
    async: boolean;
    defer: boolean;
    crossOrigin: string | null;
    onerror: (() => void) | null;
    remove(): void;
}

/** Browser globals the loader touches, injectable so it can be tested without a DOM. */
export interface FacebookSdkEnv {
    win: { FB?: FacebookSdk; fbAsyncInit?: () => void };
    doc: {
        getElementById(id: string): SdkScript | null;
        createElement(tag: 'script'): SdkScript;
        appendScript(script: SdkScript): void;
    };
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(timer: unknown): void;
}

export type FacebookSdkLoader = (appId: string, timeoutMs?: number) => Promise<FacebookSdk>;

export function createFacebookSdkLoader(env: FacebookSdkEnv): FacebookSdkLoader {
    let pending: Promise<FacebookSdk> | null = null;
    let initialisedFor: string | null = null;

    function initialise(sdk: FacebookSdk, appId: string): FacebookSdk {
        if (initialisedFor !== appId) {
            sdk.init({ appId, cookie: true, xfbml: true, version: FACEBOOK_GRAPH_VERSION });
            initialisedFor = appId;
        }
        return sdk;
    }

    function injectScript(appId: string, timeoutMs: number): Promise<FacebookSdk> {
        return new Promise<FacebookSdk>((resolve, reject) => {
            const fail = (reason: 'blocked' | 'timeout') => {
                env.clearTimer(timer);
                pending = null;
                reject(new Error(`Facebook SDK ${reason}`));
            };
            const timer = env.setTimer(() => fail('timeout'), timeoutMs);

            env.win.fbAsyncInit = () => {
                env.clearTimer(timer);
                const sdk = env.win.FB;
                if (!sdk) {
                    fail('blocked');
                    return;
                }
                resolve(initialise(sdk, appId));
            };

            // A script left over from a failed attempt would never call fbAsyncInit again.
            env.doc.getElementById(FACEBOOK_SDK_ID)?.remove();

            const script = env.doc.createElement('script');
            script.id = FACEBOOK_SDK_ID;
            script.src = FACEBOOK_SDK_SRC;
            script.async = true;
            script.defer = true;
            script.crossOrigin = 'anonymous';
            script.onerror = () => fail('blocked');
            env.doc.appendScript(script);
        });
    }

    return (appId, timeoutMs = FACEBOOK_SDK_TIMEOUT_MS) => {
        const loaded = env.win.FB;
        if (loaded) return Promise.resolve(initialise(loaded, appId));
        if (!pending) pending = injectScript(appId, timeoutMs);
        return pending;
    };
}

let browserLoader: FacebookSdkLoader | null = null;

/** Loads (or reuses) Meta's SDK in this tab. Browser only. */
export function loadFacebookSdk(appId: string, timeoutMs?: number): Promise<FacebookSdk> {
    if (!browserLoader) {
        browserLoader = createFacebookSdkLoader({
            win: window as unknown as FacebookSdkEnv['win'],
            doc: {
                getElementById: (id) => document.getElementById(id) as unknown as SdkScript | null,
                createElement: () => document.createElement('script') as unknown as SdkScript,
                appendScript: (script) => { document.body.appendChild(script as unknown as HTMLScriptElement); },
            },
            setTimer: (fn, ms) => window.setTimeout(fn, ms),
            clearTimer: (timer) => window.clearTimeout(timer as number),
        });
    }
    return browserLoader(appId, timeoutMs);
}
