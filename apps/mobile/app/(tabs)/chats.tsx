import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useConversations } from '@/api/hooks';
import { Conversation } from '@/api/types';
import { Text, Avatar, EmptyState, Badge } from '@/components/ui';
import { relativeTime } from '@/lib/format';

function ConversationRow({ item }: { item: Conversation }) {
  const t = useTheme();
  const router = useRouter();
  const title = item.customerName || item.customerPhone;
  const needsReply = item.lastMessageDirection === 'INBOUND';
  const isHuman = item.state === 'HUMAN_ACTIVE';

  return (
    <Pressable
      onPress={() => router.push(`/conversations/${item.id}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        backgroundColor: pressed ? t.colors.surfaceSunken : 'transparent',
      })}
    >
      <Avatar name={title} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Text variant="body" weight="semi" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </Text>
          <Text variant="caption" tone={needsReply ? 'primary' : 'subtle'} weight={needsReply ? 'semi' : 'regular'}>
            {relativeTime(item.lastMessageAt)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Text
            variant="bodySm"
            tone={needsReply ? 'default' : 'muted'}
            weight={needsReply ? 'medium' : 'regular'}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {item.lastMessageDirection === 'OUTBOUND' ? 'You: ' : ''}
            {item.lastMessage || 'No messages yet'}
          </Text>
          <Badge label={isHuman ? 'You' : 'Bot'} tone={isHuman ? 'primary' : 'neutral'} />
          {needsReply ? (
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.colors.primary }} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatsScreen() {
  const t = useTheme();
  const { data, isLoading, isRefetching, refetch } = useConversations();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <FlatList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow item={item} />}
        ItemSeparatorComponent={() => (
          <View style={{ height: 0.5, backgroundColor: t.colors.divider, marginLeft: 72 }} />
        )}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
        contentContainerStyle={(data ?? []).length === 0 ? { flex: 1 } : undefined}
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles-outline"
            title="No conversations yet"
            subtitle="When customers message your WhatsApp number, their chats appear here."
          />
        }
      />
    </View>
  );
}
