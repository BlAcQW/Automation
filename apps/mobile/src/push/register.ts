import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from '@/api/client';

/**
 * Ask for notification permission, obtain the Expo push token, and register it
 * with the backend (POST /devices/register). Best-effort: failures are logged,
 * never thrown, so they can't block login.
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return; // push tokens aren't issued on simulators

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    if (!token) return;

    await api.post('/devices/register', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('registerPushToken failed', err);
  }
}
