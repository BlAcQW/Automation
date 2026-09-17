import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { AxiosError } from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/api/client';
import { useTheme } from '@/theme';
import { Screen, Text, Button } from '@/components/ui';

/**
 * Request a reset link. The link itself opens the web app (it's an email
 * link, and the web reset page works on any phone browser), so this screen
 * only needs the email and a clear "go check your inbox".
 */
export default function ForgotPasswordScreen() {
  const t = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      setError(
        axiosErr.response?.status === 429
          ? 'Too many attempts. Wait a few minutes and try again.'
          : 'We could not send the email. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    backgroundColor: t.colors.surfaceSunken,
    borderColor: t.colors.border,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.lg,
    paddingVertical: 14,
    color: t.colors.text,
    fontFamily: t.fonts.bodyMedium,
    fontSize: 16,
  } as const;

  return (
    <Screen padded edges={['top', 'bottom']}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back to log in"
        style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}
      >
        <Ionicons name="chevron-back" size={22} color={t.colors.primaryText} />
        <Text variant="body" tone="primary" weight="medium">
          Log in
        </Text>
      </Pressable>

      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'center', gap: t.space.md }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {sent ? (
          <View style={{ gap: t.space.md }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: t.colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="mail-open-outline" size={28} color={t.colors.primaryText} />
            </View>
            <Text variant="h1" weight="extra">
              Check your email
            </Text>
            <Text variant="body" tone="muted">
              If there is a Bookly account for {email.trim()}, we have sent it a link to choose a new
              password. The link works for one hour.
            </Text>
            <Text variant="bodySm" tone="subtle">
              Nothing there after a minute? Look in the spam folder, or try again with the email you signed up
              with.
            </Text>
            <Button label="Back to log in" onPress={() => router.back()} fullWidth size="lg" style={{ marginTop: t.space.sm }} />
            <Button label="Use a different email" variant="secondary" onPress={() => setSent(false)} fullWidth />
          </View>
        ) : (
          <>
            <View style={{ gap: t.space.xs, marginBottom: t.space.md }}>
              <Text variant="h1" weight="extra">
                Forgot your password?
              </Text>
              <Text variant="body" tone="muted">
                Type the email you signed up with and we will send you a link to choose a new one.
              </Text>
            </View>

            {error ? (
              <View style={{ backgroundColor: t.colors.dangerSoft, borderRadius: t.radius.md, padding: t.space.md }}>
                <Text variant="bodySm" tone="danger" center>
                  {error}
                </Text>
              </View>
            ) : null}

            <TextInput
              style={inputStyle}
              placeholder="Email"
              placeholderTextColor={t.colors.textSubtle}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              autoFocus
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={onSubmit}
              returnKeyType="send"
            />

            <Button
              label="Send reset link"
              onPress={onSubmit}
              loading={submitting}
              disabled={!email.trim()}
              fullWidth
              size="lg"
              style={{ marginTop: t.space.xs }}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
