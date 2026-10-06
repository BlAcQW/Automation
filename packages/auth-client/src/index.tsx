'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TokenStorage } from '@bookingflow/api-client';
import {
    DEFAULT_ACCESS_TOKEN_COOKIE,
    accessTokenCookieString,
    clearAccessTokenCookieString,
    type AccessTokenCookieConfig,
} from './cookie';

export type { AccessTokenCookieConfig } from './cookie';

/** What every app's user has. Apps narrow `role` through the type parameter. */
export interface CoreUser {
    id: string;
    email: string;
    name: string;
    role: string;
    emailVerifiedAt?: string | null;
}

/**
 * What every tenant (organisation) has. Anything vertical-specific (booking
 * capacity, deposits, WhatsApp state, business type...) belongs in the app's own
 * extension type, passed as `TenantExtension` to `createAuthKit`.
 */
export interface CoreTenant {
    id: string;
    name: string;
    timezone: string;
    currency?: string;
    deletionRequestedAt?: string | null;
}

/** Core tenant plus an app's vertical-specific fields. */
export type TenantWith<TExtension extends object = {}> = CoreTenant & TExtension;

export interface CoreRegisterData {
    email: string;
    password: string;
    name: string;
    timezone?: string;
    acceptTerms: boolean;
}

/** The slice of an axios instance the kit needs (so tests can fake it). */
export interface AuthHttp {
    get(url: string): Promise<{ data: any }>;
    post(url: string, body?: unknown): Promise<{ data: any }>;
}

export interface AuthKitOptions {
    api: AuthHttp;
    /** Must be the same storage the api client was created with. */
    storage: TokenStorage;
    /** Where useRequireAuth sends unauthenticated visitors. Default `/login`. */
    loginPath?: string;
    endpoints?: { login?: string; register?: string; logout?: string; me?: string };
    /**
     * Presence cookie for Edge middleware. Default on, name `accessToken`, 15 min.
     * Pass `false` for apps that do not use middleware gating.
     */
    accessTokenCookie?: AccessTokenCookieConfig | false;
    /** Whether the presence cookie gets `Secure`. Default: NODE_ENV === 'production'. */
    secureCookie?: boolean;
}

export interface AuthState<TUser, TTenant> {
    user: TUser | null;
    tenant: TTenant | null;
    isLoading: boolean;
    isAuthenticated: boolean;
}

export interface AuthContextType<TUser, TTenant, TRegister> extends AuthState<TUser, TTenant> {
    login: (email: string, password: string) => Promise<void>;
    register: (data: TRegister) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

/**
 * Build an app's auth provider and hooks.
 *
 *     export const { AuthProvider, useAuth, useRequireAuth } =
 *         createAuthKit<MyUser, TenantWith<MyTenantFields>, MyRegisterData>({ api, storage });
 */
export function createAuthKit<
    TUser extends CoreUser = CoreUser,
    TTenant extends CoreTenant = CoreTenant,
    TRegister extends CoreRegisterData = CoreRegisterData,
>(options: AuthKitOptions) {
    type Ctx = AuthContextType<TUser, TTenant, TRegister>;
    type State = AuthState<TUser, TTenant>;

    const { api, storage, loginPath = '/login' } = options;
    const endpoints = {
        login: '/auth/login',
        register: '/auth/register',
        logout: '/auth/logout',
        me: '/auth/me',
        ...options.endpoints,
    };
    const cookieCfg = options.accessTokenCookie === false ? null : options.accessTokenCookie ?? DEFAULT_ACCESS_TOKEN_COOKIE;
    const secure = options.secureCookie ?? process.env.NODE_ENV === 'production';

    function setPresenceCookie(token: string) {
        if (!cookieCfg || typeof document === 'undefined') return;
        document.cookie = accessTokenCookieString(cookieCfg, token, secure);
    }
    function clearPresenceCookie() {
        if (!cookieCfg || typeof document === 'undefined') return;
        document.cookie = clearAccessTokenCookieString(cookieCfg);
    }

    const signedOut: State = { user: null, tenant: null, isLoading: false, isAuthenticated: false };
    const AuthContext = createContext<Ctx | undefined>(undefined);

    function AuthProvider({ children }: { children: ReactNode }) {
        const [state, setState] = useState<State>({ ...signedOut, isLoading: true });

        const refreshUser = useCallback(async () => {
            try {
                if (!storage.get()) {
                    setState(signedOut);
                    return;
                }
                const response = await api.get(endpoints.me);
                setState({
                    user: response.data.user,
                    tenant: response.data.tenant,
                    isLoading: false,
                    isAuthenticated: true,
                });
            } catch {
                storage.remove();
                setState(signedOut);
            }
        }, []);

        useEffect(() => {
            refreshUser();
        }, [refreshUser]);

        const establish = (data: { accessToken: string; user: TUser; tenant: TTenant }) => {
            storage.set(data.accessToken);
            setPresenceCookie(data.accessToken);
            setState({ user: data.user, tenant: data.tenant, isLoading: false, isAuthenticated: true });
        };

        const login = async (email: string, password: string) => {
            establish((await api.post(endpoints.login, { email, password })).data);
        };

        const register = async (data: TRegister) => {
            establish((await api.post(endpoints.register, data)).data);
        };

        const logout = async () => {
            try {
                await api.post(endpoints.logout);
            } catch {
                // Ignore errors during logout
            }
            storage.remove();
            clearPresenceCookie();
            setState(signedOut);
        };

        return (
            <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser }}>
                {children}
            </AuthContext.Provider>
        );
    }

    function useAuth(): Ctx {
        const context = useContext(AuthContext);
        if (context === undefined) {
            throw new Error('useAuth must be used within an AuthProvider');
        }
        return context;
    }

    /** Redirects to the login page once loading finishes unauthenticated. */
    function useRequireAuth(): Ctx {
        const auth = useAuth();
        useEffect(() => {
            if (!auth.isLoading && !auth.isAuthenticated) {
                window.location.href = loginPath;
            }
        }, [auth.isLoading, auth.isAuthenticated]);
        return auth;
    }

    return { AuthProvider, useAuth, useRequireAuth };
}
