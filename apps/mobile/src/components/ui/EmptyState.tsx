import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xl, gap: t.space.md }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: t.colors.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={30} color={t.colors.textSubtle} />
      </View>
      <Text variant="h3" weight="bold" center>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="bodySm" tone="muted" center style={{ maxWidth: 280 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
