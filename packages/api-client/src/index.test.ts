import { describe, it, expect, vi } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { createApiClient, createTokenStorage, memoryTokenStorage, type TokenStorage } from './index';

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

/** An axios adapter driven by a function, so no network and no mock library. */
function adapterFor(handler: Handler, seen: InternalAxiosRequestConfig[] = []): AxiosAdapter {
    return async (config) => {
        seen.push(config);
        const { status, data } = handler(config);
        const response = { status, statusText: String(status), data, headers: {}, config, request: {} };
        if (status >= 200 && status < 300) return response;
        const err: any = new Error(`status ${status}`);
        err.isAxiosError = true;
        err.config = config;
        err.response = response;
        throw err;
    };
}

function make(handler: Handler, extra: Partial<Parameters<typeof createApiClient>[0]> = {}) {
    const seen: InternalAxiosRequestConfig[] = [];
    const storage = memoryTokenStorage('old-token');
    const redirect = vi.fn();
    const client = createApiClient({
        baseURL: 'http://api.test',
        storage,
        redirect,
        getLocation: () => ({ pathname: '/dashboard', search: '?a=1' }),
        ...extra,
    });
    client.defaults.adapter = adapterFor(handler, seen);
    return { client, seen, storage, redirect };
}

describe('createApiClient', () => {
    it('sends credentials and the bearer token', async () => {
        const { client, seen } = make(() => ({ status: 200, data: {} }));
        expect(client.defaults.withCredentials).toBe(true);
        expect(client.defaults.baseURL).toBe('http://api.test');
        await client.get('/x');
        expect(seen[0].headers.Authorization).toBe('Bearer old-token');
    });

    it('sends no Authorization header without a token', async () => {
        const { client, seen, storage } = make(() => ({ status: 200 }));
        storage.remove();
        await client.get('/x');
        expect(seen[0].headers.Authorization).toBeUndefined();
    });

    it('on 401 refreshes once, stores the new token and replays the request', async () => {
        let calls = 0;
        const { client, seen, storage } = make((c) => {
            if (c.url === '/auth/refresh') return { status: 200, data: { accessToken: 'new-token' } };
            calls += 1;
            return calls === 1 ? { status: 401 } : { status: 200, data: { ok: true } };
        });
        const res = await client.get('/me');
        expect(res.data).toEqual({ ok: true });
        expect(storage.get()).toBe('new-token');
        const replay = seen.filter((c) => c.url === '/me')[1];
        expect(replay.headers.Authorization).toBe('Bearer new-token');
    });

    it('sends the CSRF header on refresh and logout only', async () => {
        const { client, seen } = make((c) =>
            c.url === '/auth/refresh' ? { status: 200, data: { accessToken: 't' } } : { status: 200, data: {} });
        await client.post('/auth/refresh');
        await client.post('/auth/logout');
        await client.post('/bookings');
        expect(seen[0].headers['X-Requested-With']).toBe('XMLHttpRequest');
        expect(seen[1].headers['X-Requested-With']).toBe('XMLHttpRequest');
        expect(seen[2].headers['X-Requested-With']).toBeUndefined();
    });

    it('does not retry forever: a 401 from refresh clears the token and redirects with the return path', async () => {
        const { client, storage, redirect, seen } = make(() => ({ status: 401 }));
        await expect(client.get('/me')).rejects.toBeTruthy();
        expect(storage.get()).toBeNull();
        expect(seen.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
        expect(redirect).toHaveBeenCalledWith('/login?reason=expired&next=' + encodeURIComponent('/dashboard?a=1'));
    });

    it('does not redirect to login when already on the login page', async () => {
        const { client, redirect } = make(() => ({ status: 401 }), {
            getLocation: () => ({ pathname: '/login', search: '' }),
        });
        await expect(client.get('/me')).rejects.toBeTruthy();
        expect(redirect).not.toHaveBeenCalled();
    });

    it('a 401 on the refresh call itself (direct) clears and redirects, no retry', async () => {
        const { client, storage, redirect, seen } = make(() => ({ status: 401 }));
        await expect(client.post('/auth/refresh')).rejects.toBeTruthy();
        expect(seen).toHaveLength(1);
        expect(storage.get()).toBeNull();
        expect(redirect).toHaveBeenCalledTimes(1);
    });

    it('non-401 errors pass through untouched', async () => {
        const { client, storage, redirect } = make(() => ({ status: 500 }));
        await expect(client.get('/x')).rejects.toMatchObject({ response: { status: 500 } });
        expect(storage.get()).toBe('old-token');
        expect(redirect).not.toHaveBeenCalled();
    });

    it('parameterised for another app: own paths, no ?next query, admin-style redirect', async () => {
        const { client, redirect } = make(() => ({ status: 401 }), {
            refreshPath: '/admin/auth/refresh',
            logoutPath: '/admin/auth/logout',
            loginPath: '/admin/login',
            includeReturnPath: false,
        });
        await expect(client.get('/admin/tenants')).rejects.toBeTruthy();
        expect(redirect).toHaveBeenCalledWith('/admin/login');
    });
});

describe('token storage and SSR safety', () => {
    it('createTokenStorage is inert without a window (server render)', () => {
        expect(typeof window).toBe('undefined');
        const s = createTokenStorage('accessToken');
        expect(s.get()).toBeNull();
        expect(() => s.set('x')).not.toThrow();
        expect(() => s.remove()).not.toThrow();
    });

    it('createTokenStorage uses localStorage under the given key when present', () => {
        const store = new Map<string, string>();
        (globalThis as any).window = {};
        (globalThis as any).localStorage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        };
        try {
            const s: TokenStorage = createTokenStorage('adminAccessToken');
            s.set('abc');
            expect(store.get('adminAccessToken')).toBe('abc');
            expect(s.get()).toBe('abc');
            s.remove();
            expect(s.get()).toBeNull();
        } finally {
            delete (globalThis as any).window;
            delete (globalThis as any).localStorage;
        }
    });

    it('constructing a client on the server does not touch window', () => {
        expect(() => createApiClient({ baseURL: 'http://x' })).not.toThrow();
    });
});
