import { createApiClient, createTokenStorage } from '@bookingflow/api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Tenant dashboard session. */
export const tokenStorage = createTokenStorage('accessToken');
export const api = createApiClient({
    baseURL: API_URL,
    storage: tokenStorage,
    refreshPath: '/auth/refresh',
    logoutPath: '/auth/logout',
    loginPath: '/login',
});

/** Admin session (separate token, refresh path and login page). */
export const adminApi = createApiClient({
    baseURL: API_URL,
    storage: createTokenStorage('adminAccessToken'),
    refreshPath: '/admin/auth/refresh',
    logoutPath: '/admin/auth/logout',
    loginPath: '/admin/login',
    includeReturnPath: false,
});
