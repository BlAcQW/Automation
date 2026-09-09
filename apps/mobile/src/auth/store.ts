import * as SecureStore from 'expo-secure-store';

/**
 * Persistent token storage backed by the device keychain/keystore.
 * Access token (15 min) + refresh token (7 days, rotated on refresh).
 */
const ACCESS_KEY = 'bookly.accessToken';
const REFRESH_KEY = 'bookly.refreshToken';

export async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCESS_KEY);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function setTokens(accessToken: string, refreshToken?: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  if (refreshToken) {
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
}
