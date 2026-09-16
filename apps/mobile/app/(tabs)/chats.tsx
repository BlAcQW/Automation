import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useConversations } from '@/api/hooks';
import { Conversation } from '@/api/types';
import { Text, Avatar, EmptyState, Badge, LargeHeader, QueryState, ChatRowSkeleton, SkeletonList, PressableScale } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { TAB_BAR_INSET } from '@/lib/layout';
import { usePullRefresh } from '@/lib/usePullRefresh';

function ConversationRow({ item }: { item: Conversation }) {
  const t = useTheme();
  const router = useRouter();
  const title = item.customerName || item.customerPhone;
  const needsReply = item.lastMessageDirection === 'INBOUND';
  const isHuman = item.state === 'HUMAN_ACTIVE';

  return (
    <PressableScale
      to={0.985}
      onPress={() => router.push(`/conversations/${item.id}`)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.sm + 2,
      }}
    >
      <Avatar name={title} size={56} />
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
            numberOfLines={2}
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
    </PressableScale>
  );
}

type ChatFilter = 'all' | 'unread' | 'bot' | 'you';

const FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'bot', label: 'Bot' },
  { key: 'you', label: 'You' },
];

export default function ChatsScreen() {
  const t = useTheme();
  const { data, isLoading, isError, refetch } = useConversations();
  const { refreshing, onRefresh } = usePullRefresh(refetch);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');

  // Filtering is client-side: the list is already in memory and this keeps
  // typing instant instead of round-tripping per keystroke.
  const visible = useMemo(() => {
    const all = data ?? [];
    const q = query.trim().toLowerCase();

    return all.filter((c) => {
      if (filter === 'unread' && c.lastMessageDirection !== 'INBOUND') return false;
      if (filter === 'you' && c.state !== 'HUMAN_ACTIVE') return false;
      if (filter === 'bot' && c.state === 'HUMAN_ACTIVE') return false;
      if (!q) return true;
      return (
        (c.customerName ?? '').toLowerCase().includes(q) ||
        c.customerPhone.toLowerCase().includes(q) ||
        (c.lastMessage ?? '').toLowerCase().includes(q)
      );
    });
  }, [data, query, filter]);

  const unreadCount = (data ?? []).filter((c) => c.lastMessageDirection === 'INBOUND').length;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <LargeHeader title="Chats">
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.sm,
            backgroundColor: t.colors.surfaceSunken,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.space.md,
            height: 40,
          }}
        >
          <Ionicons name="search" size={17} color={t.colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={t.colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search chats"
            style={{
              flex: 1,
              color: t.colors.text,
              fontFamily: t.fonts.bodyRegular,
              fontSize: 15,
              padding: 0,
            }}
          />
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.key}
          contentContainerStyle={{ gap: t.space.sm, paddingVertical: 2 }}
          renderItem={({ item }) => {
            const active = filter === item.key;
            const count = item.key === 'unread' ? unreadCount : 0;
            return (
              <Pressable
                onPress={() => setFilter(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: t.space.md,
                  paddingVertical: 7,
                  borderRadius: t.radius.pill,
                  backgroundColor: active ? t.colors.primarySoft : t.colors.surfaceSunken,
                }}
              >
                <Text variant="caption" weight="semi" tone={active ? 'primary' : 'muted'}>
                  {item.label}
                </Text>
                {count > 0 ? (
                  <Text variant="caption" weight="semi" tone={active ? 'primary' : 'muted'}>
                    {count}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      </LargeHeader>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        skeleton={
          <SkeletonList count={9}>
            <ChatRowSkeleton />
          </SkeletonList>
        }
      >
      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow item={item} />}
        ItemSeparatorComponent={() => (
          <View style={{ height: 0.5, backgroundColor: t.colors.divider, marginLeft: 88 }} />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />}
        keyboardDismissMode="on-drag"
        contentContainerStyle={
          visible.length === 0
            ? { flex: 1, paddingBottom: TAB_BAR_INSET }
            : { paddingBottom: TAB_BAR_INSET }
        }
        ListEmptyComponent={
          query || filter !== 'all' ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              subtitle="Try a different search, or switch back to All."
            />
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title="No conversations yet"
              subtitle="When customers message your WhatsApp number, their chats appear here."
            />
          )
        }
      />
      </QueryState>
    </View>
  );
}
