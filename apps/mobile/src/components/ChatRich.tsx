import { Linking, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';
import type { Message } from '@/api/types';

/** A shared pin/contact card — tapping opens the platform's own app. */
function Row({
  icon,
  title,
  subtitle,
  onPress,
  label,
}: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minWidth: 190,
        paddingVertical: 4,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.colors.surfaceSunken,
        }}
      >
        <Ionicons name={icon} size={18} color={t.colors.textMuted} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="bodySm" weight="semi" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ChatLocation({ message }: { message: Message }) {
  const { latitude, longitude, name, address } = message.metadata ?? {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return (
      <Text variant="bodySm" tone="muted">
        Location
      </Text>
    );
  }

  // Hand off to the platform's maps app rather than shipping a map SDK.
  const open = () => {
    const url = Platform.select({
      ios: `maps:0,0?q=${latitude},${longitude}`,
      default: `geo:${latitude},${longitude}?q=${latitude},${longitude}`,
    });
    Linking.openURL(url as string).catch(() => undefined);
  };

  return (
    <Row
      icon="location"
      title={name || 'Shared location'}
      subtitle={address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}
      onPress={open}
      label="Open in Maps"
    />
  );
}

export function ChatContact({ message }: { message: Message }) {
  const meta = message.metadata ?? {};
  const first = meta.contacts?.[0];
  const name = first?.name?.formatted_name ?? meta.name ?? message.content;
  const phone = first?.phones?.[0]?.phone ?? meta.phone;

  return (
    <Row
      icon="person"
      title={name || 'Contact'}
      subtitle={phone}
      onPress={phone ? () => Linking.openURL(`tel:${phone}`).catch(() => undefined) : undefined}
      label={phone ? `Call ${name}` : 'Contact card'}
    />
  );
}
