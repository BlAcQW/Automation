import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { WHATSAPP_APP_ID, WHATSAPP_CONFIG_ID, WHATSAPP_NATIVE_REDIRECT } from '@/lib/config';

/**
 * Native WhatsApp Embedded Signup via a WebView OAuth session.
 *
 * Flow: open the Facebook OAuth dialog (with the WhatsApp `config_id`) →
 * Facebook redirects to the backend https callback → backend 302s to the app
 * scheme (bookly://whatsapp?code=…) → we capture the code and POST it to
 * /whatsapp/embedded-signup with the same redirect_uri.
 *
 * Requires (set once): EXPO_PUBLIC_WHATSAPP_APP_ID + EXPO_PUBLIC_WHATSAPP_CONFIG_ID,
 * and the redirect URL whitelisted in the Meta app's Valid OAuth Redirect URIs.
 */
const GRAPH_VERSION = 'v21.0';

function buildAuthUrl(): string {
  const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  u.searchParams.set('client_id', WHATSAPP_APP_ID);
  u.searchParams.set('redirect_uri', WHATSAPP_NATIVE_REDIRECT);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('config_id', WHATSAPP_CONFIG_ID);
  u.searchParams.set('override_default_response_type', 'true');
  return u.toString();
}

export function useEmbeddedSignup() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfigured = !!WHATSAPP_APP_ID && !!WHATSAPP_CONFIG_ID;

  async function start(): Promise<boolean> {
    setError(null);
    if (!isConfigured) {
      setError('Embedded Signup isn’t configured in this build. Use manual connect below.');
      return false;
    }
    setRunning(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(buildAuthUrl(), 'bookly://whatsapp');
      if (result.type !== 'success' || !result.url) {
        return false; // user dismissed
      }
      const returned = new URL(result.url);
      const code = returned.searchParams.get('code');
      const oauthError = returned.searchParams.get('error');
      if (oauthError || !code) {
        setError('Facebook sign-in was cancelled or failed.');
        return false;
      }
      await api.post('/whatsapp/embedded-signup', { code, redirectUri: WHATSAPP_NATIVE_REDIRECT });
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      return true;
    } catch {
      setError('Could not complete WhatsApp connection. Try again or use manual connect.');
      return false;
    } finally {
      setRunning(false);
    }
  }

  return { start, running, error, isConfigured };
}
