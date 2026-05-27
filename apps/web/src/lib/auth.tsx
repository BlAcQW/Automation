'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

// Token cookie: read by Next.js Edge middleware so it can redirect
// unauthenticated requests BEFORE rendering any protected page (no flash of
// protected content). The cookie carries the same accessToken as localStorage
// — middleware only checks for its presence, server-side route handlers
// continue to verify the JWT for real.
const ACCESS_TOKEN_COOKIE = 'accessToken';

function setAccessTokenCookie(token: string) {
    if (typeof document === 'undefined') return;
    const isProduction = process.env.NODE_ENV === 'production';
    // 15-minute access token TTL matches the API's JWT_EXPIRES_IN.
    document.cookie = `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=900; samesite=lax${isProduction ? '; secure' : ''}`;
}

function clearAccessTokenCookie() {
    if (typeof document === 'undefined') return;
    document.cookie = `${ACCESS_TOKEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

interface User {
    id: string;
    email: string;
    name: string;
    role: 'OWNER' | 'STAFF';
}

interface Tenant {
    id: string;
    name: string;
    businessType: 'PRODUCT' | 'SERVICE';
    timezone: string;
    whatsappConnected?: boolean;
}

interface AuthState {
    user: User | null;
    tenant: Tenant | null;
    isLoading: boolean;
    isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
    login: (email: string, password: string) => Promise<void>;
    register: (data: RegisterData) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

interface RegisterData {
    email: string;
    password: string;
    name: string;
    businessName: string;
    businessType: 'PRODUCT' | 'SERVICE';
    timezone?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        tenant: null,
        isLoading: true,
        isAuthenticated: false,
    });

    const refreshUser = useCallback(async () => {
        try {
            const accessToken = localStorage.getItem('accessToken');
            if (!accessToken) {
                setState({ user: null, tenant: null, isLoading: false, isAuthenticated: false });
                return;
            }

            const response = await api.get('/auth/me');
            setState({
                user: response.data.user,
                tenant: response.data.tenant,
                isLoading: false,
                isAuthenticated: true,
            });
        } catch (error) {
            localStorage.removeItem('accessToken');
            setState({ user: null, tenant: null, isLoading: false, isAuthenticated: false });
        }
    }, []);

    useEffect(() => {
        refreshUser();
    }, [refreshUser]);

    const login = async (email: string, password: string) => {
        const response = await api.post('/auth/login', { email, password });
        localStorage.setItem('accessToken', response.data.accessToken);
        setAccessTokenCookie(response.data.accessToken);
        setState({
            user: response.data.user,
            tenant: response.data.tenant,
            isLoading: false,
            isAuthenticated: true,
        });
    };

    const register = async (data: RegisterData) => {
        const response = await api.post('/auth/register', data);
        localStorage.setItem('accessToken', response.data.accessToken);
        setAccessTokenCookie(response.data.accessToken);
        setState({
            user: response.data.user,
            tenant: response.data.tenant,
            isLoading: false,
            isAuthenticated: true,
        });
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            // Ignore errors during logout
        }
        localStorage.removeItem('accessToken');
        clearAccessTokenCookie();
        setState({ user: null, tenant: null, isLoading: false, isAuthenticated: false });
    };

    return (
        <AuthContext.Provider
            value={{
                ...state,
                login,
                register,
                logout,
                refreshUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// Hook to require authentication
export function useRequireAuth() {
    const auth = useAuth();

    useEffect(() => {
        if (!auth.isLoading && !auth.isAuthenticated) {
            window.location.href = '/login';
        }
    }, [auth.isLoading, auth.isAuthenticated]);

    return auth;
}
