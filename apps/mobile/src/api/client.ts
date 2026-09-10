import axios from 'axios';
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL, CLIENT_HEADER } from '@/lib/config';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/auth/store';

/**
 * Axios client mirroring the web app's 401 → refresh → retry flow
 * (apps/web/src/lib/api.ts), adapted for mobile: tokens live in SecureStore,
 * the refresh token travels in the request BODY (no cookies on native), and
 * every request carries `X-Client: mobile` so the backend uses the body path.
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { ...CLIENT_HEADER },
  timeout: 15000,
});

// Called when refresh ultimately fails, so the app can drop to the login screen.
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  config.headers.set('X-Client', 'mobile');
  return config;
});

// Single-flight refresh: concurrent 401s wait on one refresh call.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
      { headers: { ...CLIENT_HEADER, 'Content-Type': 'application/json' } },
    );
    const newAccess: string | undefined = res.data?.accessToken;
    const rotated: string | undefined = res.data?.refreshToken;
    if (!newAccess) return null;
    await setTokens(newAccess, rotated);
    return newAccess;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const isRefreshCall = original?.url?.includes('/auth/refresh');

    if (status === 401 && original && !original._retry && !isRefreshCall) {
      original._retry = true;
      if (!refreshing) {
        refreshing = refreshAccessToken().finally(() => {
          refreshing = null;
        });
      }
      const newToken = await refreshing;
      if (newToken) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${newToken}` };
        return api(original);
      }
      await clearTokens();
      onAuthFailure?.();
    }

    return Promise.reject(error);
  },
);
