import { TextInput, TextInputProps, View } from 'react-native';
import { useTheme } from '@/theme';
import { Text } from './Text';

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, style, ...rest }: FieldProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" weight="semi" tone="muted">
        {label}
      </Text>
      <TextInput
        placeholderTextColor={t.colors.textSubtle}
        style={[
          {
            backgroundColor: t.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: error ? t.colors.danger : t.colors.border,
            borderRadius: t.radius.md,
            paddingHorizontal: t.space.md,
            paddingVertical: 12,
            color: t.colors.text,
            fontFamily: t.fonts.bodyRegular,
            fontSize: 16,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="subtle">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
