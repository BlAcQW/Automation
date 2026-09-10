import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { AxiosError } from 'axios';
import { useTheme } from '@/theme';
import { useConversations, useMessages, useResumeBot, useSendMessage } from '@/api/hooks';
import { Message } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Badge } from '@/components/ui';
import { formatTime } from '@/lib/format';

const WINDOW_MS = 24 * 60 * 60 * 1000;

function Bubble({ item }: { item: Message }) {
  const t = useTheme();
  const outbound = item.direction === 'OUTBOUND';
  return (
    <View style={{ paddingHorizontal: t.space.lg, marginVertical: 3, alignItems: outbound ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '82%',
          backgroundColor: outbound ? t.colors.primary : t.colors.surface,
          borderColor: t.colors.border,
          borderWidth: outbound ? 0 : 0.5,
          borderRadius: t.radius.lg,
          borderBottomRightRadius: outbound ? 6 : t.radius.lg,
          borderBottomLeftRadius: outbound ? t.radius.lg : 6,
          paddingHorizontal: t.space.md,
          paddingVertical: t.space.sm,
        }}
      >
        <Text variant="body" style={{ color: outbound ? t.colors.onPrimary : t.colors.text }}>
          {item.content}
        </Text>
        <Text
          variant="caption"
          style={{ color: outbound ? t.colors.onPrimary : t.colors.textSubtle, opacity: 0.8, marginTop: 3, alignSelf: 'flex-end' }}
        >
          {formatTime(item.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default function ConversationThread() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);

  const { data: conversations } = useConversations();
  const meta = conversations?.find((c) => c.id === conversationId);
  const { data: messages, isLoading } = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const resumeBot = useResumeBot(conversationId);

  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const withinWindow = useMemo(() => {
    if (!meta?.lastInboundAt) return true; // unknown → let the server decide
    return Date.now() - new Date(meta.lastInboundAt).getTime() < WINDOW_MS;
  }, [meta?.lastInboundAt]);

  const reversed = useMemo(() => (messages ? [...messages].reverse() : []), [messages]);
  const isHuman = meta?.state === 'HUMAN_ACTIVE';
  const title = meta?.customerName || meta?.customerPhone || 'Conversation';

  async function onSend() {
    const text = draft.trim();
    if (!text) return;
    setNotice(null);
    try {
      await send.mutateAsync(text);
      setDraft('');
    } catch (err) {
      const e = err as AxiosError<{ message?: string }>;
      if (e.response?.status === 402) setNotice('Message quota reached for this cycle. Upgrade your plan to send more.');
      else if (e.response?.status === 400) setNotice('Outside the 24-hour window — you can only send an approved template now.');
      else setNotice(e.response?.data?.message ?? 'Could not send. Try again.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader
        title={title}
        subtitle={meta ? (isHuman ? 'You are replying' : 'Bot is handling') : undefined}
        right={
          isHuman ? (
            <Pressable
              onPress={() => resumeBot.mutate()}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: pressed ? 0.6 : 1,
                paddingHorizontal: t.space.sm,
                paddingVertical: 6,
                borderRadius: t.radius.pill,
                backgroundColor: t.colors.primarySoft,
              })}
            >
              <Ionicons name="sparkles" size={14} color={t.colors.primaryText} />
              <Text variant="caption" weight="semi" tone="primary">
                Resume bot
              </Text>
            </Pressable>
          ) : (
            <Badge label="Bot" tone="neutral" />
          )
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={t.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={reversed}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Bubble item={item} />}
            contentContainerStyle={{ paddingVertical: t.space.md }}
          />
        )}

        {notice ? (
          <View style={{ paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, backgroundColor: t.colors.warningSoft }}>
            <Text variant="caption" tone="warning">
              {notice}
            </Text>
          </View>
        ) : null}

        {/* Composer */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: t.space.sm,
            paddingHorizontal: t.space.md,
            paddingTop: t.space.sm,
            paddingBottom: Math.max(insets.bottom, t.space.sm),
            borderTopWidth: 0.5,
            borderTopColor: t.colors.border,
            backgroundColor: t.colors.surfaceElevated,
          }}
        >
          <TextInput
            style={{
              flex: 1,
              maxHeight: 120,
              backgroundColor: t.colors.surfaceSunken,
              borderRadius: t.radius.xl,
              paddingHorizontal: t.space.lg,
              paddingVertical: 10,
              color: t.colors.text,
              fontFamily: t.fonts.bodyRegular,
              fontSize: 16,
            }}
            placeholder={withinWindow ? 'Message…' : 'Outside 24h window — template only'}
            placeholderTextColor={t.colors.textSubtle}
            value={draft}
            onChangeText={setDraft}
            editable={withinWindow}
            multiline
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={onSend}
            disabled={!withinWindow || !draft.trim() || send.isPending}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: !withinWindow || !draft.trim() ? t.colors.surfaceSunken : t.colors.primary,
            }}
          >
            {send.isPending ? (
              <ActivityIndicator color={t.colors.onPrimary} />
            ) : (
              <Ionicons
                name="send"
                size={19}
                color={!withinWindow || !draft.trim() ? t.colors.textSubtle : t.colors.onPrimary}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
