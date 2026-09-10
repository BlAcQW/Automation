import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/theme';
import { useUnreadCount } from '@/api/hooks';
import { Text, Card, Avatar, Badge, Button } from '@/components/ui';

type IoniconName = keyof typeof Ionicons.glyphMap;

function Row({
  icon,
  label,
  onPress,
  trailing,
  first,
  last,
}: {
  icon: IoniconName;
  label: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: 14,
        backgroundColor: pressed ? t.colors.surfaceSunken : t.colors.surface,
        borderTopLeftRadius: first ? t.radius.lg : 0,
        borderTopRightRadius: first ? t.radius.lg : 0,
        borderBottomLeftRadius: last ? t.radius.lg : 0,
        borderBottomRightRadius: last ? t.radius.lg : 0,
      })}
    >
      <Ionicons name={icon} size={20} color={t.colors.primaryText} />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      {trailing}
      <Ionicons name="chevron-forward" size={18} color={t.colors.textSubtle} />
    </Pressable>
  );
}

function Divider() {
  const t = useTheme();
  return <View style={{ height: 0.5, backgroundColor: t.colors.divider, marginLeft: 52 }} />;
}

export default function MoreScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, tenant, logout } = useAuth();
  const { data: unread } = useUnreadCount();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
      <Card padded style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <Avatar name={user?.name ?? tenant?.name ?? '?'} size={52} />
        <View style={{ flex: 1 }}>
          <Text variant="h3" weight="bold" numberOfLines={1}>
            {user?.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {user?.email}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
            <Badge label={tenant?.businessType ?? 'SERVICE'} tone="primary" />
            <Badge label={user?.role ?? 'OWNER'} tone="neutral" />
          </View>
        </View>
      </Card>

      <View style={{ borderRadius: t.radius.lg, overflow: 'hidden', ...t.elevation(1) }}>
        <Row
          icon="notifications-outline"
          label="Notifications"
          first
          onPress={() => router.push('/notifications')}
          trailing={unread && unread > 0 ? <Badge label={String(unread)} tone="primary" /> : undefined}
        />
        <Divider />
        <Row icon="time-outline" label="Availability" onPress={() => router.push('/availability')} />
        <Divider />
        <Row icon="document-text-outline" label="Message templates" onPress={() => router.push('/templates')} />
        <Divider />
        <Row icon="logo-whatsapp" label="WhatsApp" onPress={() => router.push('/whatsapp')} />
        <Divider />
        <Row icon="people-outline" label="Team" onPress={() => router.push('/team')} />
        <Divider />
        <Row icon="settings-outline" label="Settings" last onPress={() => router.push('/settings')} />
      </View>

      <Button label="Log out" variant="secondary" icon="log-out-outline" fullWidth onPress={logout} />

      <Text variant="caption" tone="subtle" center>
        Bookly · v0.0.1
      </Text>
    </ScrollView>
  );
}
