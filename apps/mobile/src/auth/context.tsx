import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setOnAuthFailure } from '@/api/client';
import { clearTokens, getAccessToken, setTokens } from '@/auth/store';
import { registerPushToken } from '@/push/register';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'STAFF';
}

export interface AuthTenant {
  id: string;
  name: string;
  businessType: 'SERVICE' | 'PRODUCT';
  timezone: string;
  whatsappConnected?: boolean;
  outOfWindowMessagesEnabled?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenant, setTenant] = useState<AuthTenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setUser(null);
      setTenant(null);
      return;
    }
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
      setTenant(res.data.tenant);
    } catch {
      setUser(null);
      setTenant(null);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    await clearTokens();
    setUser(null);
    setTenant(null);
  }, []);

  // If a refresh ultimately fails, drop the session.
  useEffect(() => {
    setOnAuthFailure(() => {
      setUser(null);
      setTenant(null);
    });
    return () => setOnAuthFailure(null);
  }, []);

  // Bootstrap on launch.
  useEffect(() => {
    (async () => {
      await refreshUser();
      setIsLoading(false);
    })();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { accessToken, refreshToken } = res.data;
    await setTokens(accessToken, refreshToken);
    setUser(res.data.user);
    setTenant(res.data.tenant);
    // Register for push in the background — never block the login result.
    registerPushToken();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      tenant,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
      refreshUser,
    }),
    [user, tenant, isLoading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
