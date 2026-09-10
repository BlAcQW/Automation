import { Text as RNText, TextProps as RNTextProps, TextStyle } from 'react-native';
import { useTheme } from '@/theme';

type Variant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'bodySm' | 'caption';
type Tone = 'default' | 'muted' | 'subtle' | 'primary' | 'danger' | 'success' | 'warning' | 'onPrimary';

interface AppTextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: 'regular' | 'medium' | 'semi' | 'bold' | 'extra';
  center?: boolean;
}

export function Text({
  variant = 'body',
  tone = 'default',
  weight,
  center,
  style,
  ...rest
}: AppTextProps) {
  const t = useTheme();

  const isHeading = variant === 'display' || variant === 'h1' || variant === 'h2' || variant === 'h3';
  const defaultWeight = isHeading ? 'bold' : 'regular';
  const w = weight ?? defaultWeight;

  const family: Record<string, string> = {
    regular: t.fonts.bodyRegular,
    medium: t.fonts.bodyMedium,
    semi: t.fonts.bodySemi,
    bold: t.fonts.display,
    extra: t.fonts.displayExtra,
  };

  const toneColor: Record<Tone, string> = {
    default: t.colors.text,
    muted: t.colors.textMuted,
    subtle: t.colors.textSubtle,
    primary: t.colors.primaryText,
    danger: t.colors.danger,
    success: t.colors.success,
    warning: t.colors.warning,
    onPrimary: t.colors.onPrimary,
  };

  const base: TextStyle = {
    ...t.type[variant],
    fontFamily: family[w],
    color: toneColor[tone],
    ...(center ? { textAlign: 'center' } : null),
  };

  return <RNText {...rest} style={[base, style]} />;
}
