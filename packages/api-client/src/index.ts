import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

/** Where the access token lives. Defaults to localStorage; inert on the server. */
export interface TokenStorage {
    get(): string | null;
    set(token: string): void;
    remove(): void;
}

/** localStorage under `key`. Every method is a no-op/null when there is no window (SSR). */
export function createTokenStorage(key: string): TokenStorage {
    const available = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';
    return {
        get: () => (available() ? localStorage.getItem(key) : null),
        set: (token) => {
            if (available()) localStorage.setItem(key, token);
        },
        remove: () => {
            if (available()) localStorage.removeItem(key);
        },
    };
}

/** In-memory storage, for tests and non-browser callers. */
export function memoryTokenStorage(initial: string | null = null): TokenStorage {
    let token = initial;
    return { get: () => token, set: (t) => void (token = t), remove: () => void (token = null) };
}

/**
 * Header sent on refresh and logout. The API (plugins/csrf.ts) requires it,
 * with an allowed Origin, when cross-site auth is on: a cross-site form cannot
 * set a custom header, and a cross-site fetch that does needs a CORS preflight.
 * It is harmless when cross-site auth is off.
 */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

export interface ApiClientOptions {
    /** API base URL. */
    baseURL: string;
    /** Access-token storage. Default: localStorage key `accessToken`. */
    storage?: TokenStorage;
    /** Endpoint that trades the refresh cookie for a new access token. Default `/auth/refresh`. */
    refreshPath?: string;
    /** Endpoint that clears the refresh cookie. Default `/auth/logout`. */
    logoutPath?: string;
    /** Where to send the user when the session is gone. Default `/login`. */
    loginPath?: string;
    /** Append `?reason=expired&next=<current path>` to the login redirect. Default true. */
    includeReturnPath?: boolean;
    /** Override navigation (tests, native shells). Default: `window.location.href = url`. */
    redirect?: (url: string) => void;
    /** Override the current location. Default: `window.location`. */
    getLocation?: () => { pathname: string; search: string } | null;
}

export function createApiClient(options: ApiClientOptions): AxiosInstance {
    const {
        baseURL,
        storage = createTokenStorage('accessToken'),
        refreshPath = '/auth/refresh',
        logoutPath = '/auth/logout',
        loginPath = '/login',
        includeReturnPath = true,
        redirect = defaultRedirect,
        getLocation = defaultLocation,
    } = options;

    const client = axios.create({
        baseURL,
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
    });

    client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
        const token = storage.get();
        if (token) config.headers.Authorization = `Bearer ${token}`;
        const url = config.url ?? '';
        if (url.includes(refreshPath) || url.includes(logoutPath)) {
            config.headers[CSRF_HEADER_NAME] = CSRF_HEADER_VALUE;
        }
        return config;
    });

    /** Session is gone: forget the token and send the user to log in. */
    function sessionEnded(withReturnPath: boolean) {
        storage.remove();
        const loc = getLocation();
        if (withReturnPath) {
            // Already on the login page: nothing to redirect to.
            if (!loc || loc.pathname.startsWith(loginPath)) return;
            const next = encodeURIComponent(loc.pathname + loc.search);
            redirect(`${loginPath}?reason=expired&next=${next}`);
        } else {
            redirect(loginPath);
        }
    }

    client.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
            const isRefreshCall = originalRequest?.url?.includes(refreshPath);

            // The refresh call itself was refused: truly unauthenticated. Do not
            // enter the retry path or this loops forever.
            if (error.response?.status === 401 && isRefreshCall) {
                sessionEnded(includeReturnPath);
                return Promise.reject(error);
            }

            if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
                originalRequest._retry = true;
                try {
                    const response = await client.post(refreshPath);
                    const { accessToken } = response.data;
                    storage.set(accessToken);
                    originalRequest.headers.Authorization = `Bearer ${accessToken}`;
                    return client(originalRequest);
                } catch (refreshError) {
                    // A 401 from the refresh call was already handled above (with
                    // the reason and return path). Anything else (network error,
                    // 5xx) also ends the session.
                    if ((refreshError as AxiosError).response?.status !== 401) {
                        storage.remove();
                        redirect(loginPath);
                    }
                    return Promise.reject(refreshError);
                }
            }

            return Promise.reject(error);
        },
    );

    return client;
}

function defaultRedirect(url: string) {
    if (typeof window !== 'undefined') window.location.href = url;
}

function defaultLocation() {
    return typeof window !== 'undefined' ? window.location : null;
}
