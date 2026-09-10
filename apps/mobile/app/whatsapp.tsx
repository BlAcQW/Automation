import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { useConnectWhatsapp, useWhatsappStatus } from '@/api/hooks';
import { useEmbeddedSignup } from '@/features/whatsapp/useEmbeddedSignup';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Badge, Field, Button } from '@/components/ui';

export default function WhatsappScreen() {
  const t = useTheme();
  const { data, isLoading } = useWhatsappStatus();
  const connect = useConnectWhatsapp();
  const embedded = useEmbeddedSignup();
  const connected = !!data?.connected;

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [displayNumber, setDisplayNumber] = useState('');
  const [note, setNote] = useState<string | null>(null);

  async function onConnect() {
    setNote(null);
    if (!phoneNumberId.trim() || !accountId.trim() || !accessToken.trim()) {
      setNote('Fill in Phone Number ID, WABA ID and the access token.');
      return;
    }
    try {
      await connect.mutateAsync({
        phoneNumberId: phoneNumberId.trim(),
        accountId: accountId.trim(),
        accessToken: accessToken.trim(),
        displayNumber: displayNumber.trim() || undefined,
      });
      setAccessToken('');
    } catch {
      setNote('Could not connect. Check the values and try again.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title="WhatsApp" />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
          <Card padded style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: connected ? t.colors.successSoft : t.colors.warningSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="logo-whatsapp" size={26} color={connected ? t.colors.success : t.colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="h3" weight="bold">
                {connected ? 'Connected' : 'Not connected'}
              </Text>
              <Text variant="caption" tone="muted">
                {connected ? data?.displayNumber ?? 'Your bot is live' : 'Connect your WhatsApp Business number'}
              </Text>
            </View>
            <Badge label={connected ? 'Live' : 'Setup'} tone={connected ? 'success' : 'warning'} />
          </Card>

          {connected ? (
            <Card padded style={{ gap: t.space.xs }}>
              <Text variant="bodySm" weight="semi">
                Everything&apos;s running
              </Text>
              <Text variant="caption" tone="muted">
                Your bot answers customers, books appointments, and sends confirmations automatically. To reconnect a
                different number, use the web dashboard.
              </Text>
            </Card>
          ) : (
            <>
              {embedded.isConfigured ? (
                <Card padded style={{ gap: t.space.md }}>
                  <View style={{ gap: 4 }}>
                    <Text variant="bodySm" weight="semi">
                      Quick connect
                    </Text>
                    <Text variant="caption" tone="muted">
                      Sign in with Facebook and pick your WhatsApp Business number.
                    </Text>
                  </View>
                  <Button
                    label="Connect with Facebook"
                    icon="logo-facebook"
                    fullWidth
                    loading={embedded.running}
                    onPress={embedded.start}
                  />
                  {embedded.error ? (
                    <Text variant="caption" tone="danger">
                      {embedded.error}
                    </Text>
                  ) : null}
                </Card>
              ) : null}

              <Card padded style={{ gap: t.space.lg }}>
                <View style={{ gap: 4 }}>
                  <Text variant="bodySm" weight="semi">
                    Connect manually
                  </Text>
                  <Text variant="caption" tone="muted">
                    Paste from Meta → WhatsApp → API Setup. Or use Quick connect above.
                  </Text>
                </View>
                <Field label="Phone Number ID" value={phoneNumberId} onChangeText={setPhoneNumberId} autoCapitalize="none" />
                <Field label="WhatsApp Business Account ID" value={accountId} onChangeText={setAccountId} autoCapitalize="none" />
                <Field label="Access token" value={accessToken} onChangeText={setAccessToken} autoCapitalize="none" secureTextEntry />
                <Field label="Display number (optional)" value={displayNumber} onChangeText={setDisplayNumber} placeholder="+233 …" />
                {note ? (
                  <Text variant="caption" tone="danger">
                    {note}
                  </Text>
                ) : null}
                <Button label="Connect" fullWidth loading={connect.isPending} onPress={onConnect} />
              </Card>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
