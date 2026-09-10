import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon,
  fullWidth,
  style,
}: ButtonProps) {
  const t = useTheme();
  const isDisabled = disabled || loading;

  const heights: Record<Size, number> = { sm: 40, md: 48, lg: 54 };
  const padX: Record<Size, number> = { sm: t.space.md, md: t.space.lg, lg: t.space.xl };

  const bg: Record<Variant, string> = {
    primary: t.colors.primary,
    secondary: t.colors.surfaceSunken,
    ghost: 'transparent',
    danger: t.colors.danger,
  };
  const fg: Record<Variant, string> = {
    primary: t.colors.onPrimary,
    secondary: t.colors.text,
    ghost: t.colors.primaryText,
    danger: '#FFFFFF',
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: padX[size],
          borderRadius: t.radius.md,
          backgroundColor: bg[variant],
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.colors.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={fg[variant]} /> : null}
          <Text
            variant={size === 'sm' ? 'bodySm' : 'body'}
            weight="semi"
            style={{ color: fg[variant] }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
