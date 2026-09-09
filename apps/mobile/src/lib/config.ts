/**
 * App configuration. Override the API base URL for local dev by setting
 * EXPO_PUBLIC_API_URL (e.g. http://192.168.1.50:3001) in a .env file — Expo
 * inlines EXPO_PUBLIC_* at build time. Defaults to the live API.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://bookly.ikieguy.online/api';

// Sent on every request so the backend returns/accepts the refresh token in the
// body instead of a cookie (see apps/api/src/routes/auth/index.ts → isMobileClient).
export const CLIENT_HEADER = { 'X-Client': 'mobile' } as const;
