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

// Meta WhatsApp Embedded Signup (native WebView flow). Set these to your live
// Meta app values via EXPO_PUBLIC_* env vars.
export const WHATSAPP_APP_ID = process.env.EXPO_PUBLIC_WHATSAPP_APP_ID ?? '';
export const WHATSAPP_CONFIG_ID = process.env.EXPO_PUBLIC_WHATSAPP_CONFIG_ID ?? '';

// The https redirect Facebook returns to; the backend bounces it to the app.
// Must be whitelisted in the Meta app's Valid OAuth Redirect URIs.
export const WHATSAPP_NATIVE_REDIRECT = `${API_BASE_URL}/whatsapp/native-callback`;

