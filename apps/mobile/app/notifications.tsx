import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useMarkAllRead, useNotifications } from '@/api/hooks';
import { AppNotification, NotificationType } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, EmptyState } from '@/components/ui';
import { relativeTime } from '@/lib/format';

type IoniconName = keyof typeof Ionicons.glyphMap;

const ICON: Record<NotificationType, IoniconName> = {
  NEW_BOOKING: 'calendar',
  BOOKING_CANCELLED: 'close-circle',
  NEW_CONVERSATION: 'chatbubble',
  SYSTEM: 'information-circle',
};

function Item({ item }: { item: AppNotification }) {
  const t = useTheme();
  const router = useRouter();
  const meta = item.metadata as { conversationId?: string; bookingId?: string } | null;

  function onPress() {
    if (meta?.conversationId) router.push(`/conversations/${meta.conversationId}`);
    else if (meta?.bookingId) router.push(`/bookings/${meta.bookingId}`);
  }

  const toneColor =
    item.type === 'BOOKING_CANCELLED' ? t.colors.danger : item.type === 'SYSTEM' ? t.colors.info : t.colors.primaryText;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        backgroundColor: pressed ? t.colors.surfaceSunken : item.isRead ? 'transparent' : t.colors.surface,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          backgroundColor: t.colors.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={ICON[item.type] ?? 'notifications'} size={18} color={toneColor} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Text variant="bodySm" weight="semi" numberOfLines={1} style={{ flex: 1 }}>
            {item.title}
          </Text>
          <Text variant="caption" tone="subtle">
            {relativeTime(item.createdAt)}
          </Text>
        </View>
        <Text variant="bodySm" tone="muted" numberOfLines={2}>
          {item.message}
        </Text>
      </View>
      {!item.isRead ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.primary, marginTop: 6 }} />
      ) : null}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const t = useTheme();
  const { data, isLoading, isRefetching, refetch } = useNotifications();
  const markAll = useMarkAllRead();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader
        title="Notifications"
        right={
          <Pressable onPress={() => markAll.mutate()} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text variant="caption" weight="semi" tone="primary">
              Mark all read
            </Text>
          </Pressable>
        }
      />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => <Item item={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: t.colors.divider, marginLeft: 66 }} />}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
          contentContainerStyle={(data ?? []).length === 0 ? { flex: 1 } : undefined}
          ListEmptyComponent={<EmptyState icon="notifications-outline" title="You're all caught up" subtitle="New bookings and messages will appear here." />}
        />
      )}
    </View>
  );
}
