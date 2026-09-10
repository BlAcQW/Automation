import { View, ViewProps, ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

interface CardProps extends ViewProps {
  padded?: boolean;
  elevated?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export function Card({ padded = true, elevated = true, style, children, ...rest }: CardProps) {
  const t = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          borderWidth: t.scheme === 'dark' ? StyleSheet_hairline : 0,
          borderColor: t.colors.border,
          ...(padded ? { padding: t.space.lg } : null),
          ...(elevated ? t.elevation(1) : null),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Hairline in dark mode gives cards a crisp edge where shadows read weakly.
const StyleSheet_hairline = 0.5;
