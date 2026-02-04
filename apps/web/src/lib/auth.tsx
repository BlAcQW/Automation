'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

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
        } catch (error) {
            // Ignore errors during logout
        }
        localStorage.removeItem('accessToken');
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
