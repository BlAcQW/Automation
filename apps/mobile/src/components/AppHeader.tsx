import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Text } from './ui/Text';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}

// Themed navigation header for pushed (stack) screens.
export function AppHeader({ title, subtitle, right, onBack }: AppHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={{
        paddingTop: insets.top + t.space.xs,
        paddingBottom: t.space.md,
        paddingHorizontal: t.space.sm,
        backgroundColor: t.colors.surfaceElevated,
        borderBottomWidth: 0.5,
        borderBottomColor: t.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={10}
        onPress={onBack ?? (() => router.back())}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="chevron-back" size={26} color={t.colors.text} />
      </Pressable>

      <View style={{ flex: 1 }}>
        <Text variant="h3" weight="bold" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right ? <View style={{ paddingRight: t.space.xs }}>{right}</View> : null}
    </View>
  );
}
