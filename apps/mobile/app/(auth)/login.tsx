import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { AxiosError } from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/theme';
import { Screen, Text, Button } from '@/components/ui';

export default function LoginScreen() {
  const t = useTheme();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      setError(axiosErr.response?.data?.message ?? 'Login failed. Check your details and try again.');
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
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'center', gap: t.space.md }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ alignItems: 'center', marginBottom: t.space.xl, gap: t.space.sm }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: t.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              ...t.elevation(2),
            }}
          >
            <Ionicons name="calendar-clear" size={30} color={t.colors.onPrimary} />
          </View>
          <Text variant="display" weight="extra">
            Bookly
          </Text>
          <Text variant="bodySm" tone="muted">
            Run your bookings from anywhere
          </Text>
        </View>

        {error ? (
          <View
            style={{
              backgroundColor: t.colors.dangerSoft,
              borderRadius: t.radius.md,
              padding: t.space.md,
            }}
          >
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
          value={email}
          onChangeText={setEmail}
        />
        <View style={{ justifyContent: 'center' }}>
          <TextInput
            style={{ ...inputStyle, paddingRight: 52 }}
            placeholder="Password"
            placeholderTextColor={t.colors.textSubtle}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            style={{ position: 'absolute', right: t.space.lg, padding: 4 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={t.colors.textSubtle}
            />
          </Pressable>
        </View>

        <Button label="Log in" onPress={onSubmit} loading={submitting} fullWidth size="lg" style={{ marginTop: t.space.xs }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
