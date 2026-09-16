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
import * as ImagePicker from 'expo-image-picker';
import { useConversations, useMessages, useResumeBot, useSendMedia, useSendMessage, useSendRich, useTakeOver } from '@/api/hooks';
import { ChatMedia } from '@/components/ChatMedia';
import { ChatContact, ChatLocation } from '@/components/ChatRich';
import { DeliveryTicks } from '@/components/DeliveryTicks';
import * as haptics from '@/lib/haptics';
import Animated, { FadeInUp, LinearTransition } from 'react-native-reanimated';
import { Message } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text } from '@/components/ui';
import { formatTime } from '@/lib/format';

const WINDOW_MS = 24 * 60 * 60 * 1000;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function Bubble({
  item,
  conversationId,
  onReact,
}: {
  item: Message;
  conversationId: string;
  onReact?: (message: Message) => void;
}) {
  const t = useTheme();
  const outbound = item.direction === 'OUTBOUND';
  const type = item.messageType ?? 'TEXT';
  const hasMedia = ['IMAGE', 'VIDEO', 'AUDIO', 'STICKER', 'DOCUMENT'].includes(type);
  const isLocation = type === 'LOCATION';
  const isContact = type === 'CONTACT';
  const isReaction = type === 'REACTION';
  const structured = hasMedia || isLocation || isContact;
  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      layout={LinearTransition.duration(160)}
      style={{ paddingHorizontal: t.space.lg, marginVertical: 3, alignItems: outbound ? 'flex-end' : 'flex-start' }}
    >
      <Pressable
        onLongPress={onReact && !isReaction ? () => { haptics.select(); onReact(item); } : undefined}
        delayLongPress={250}
        accessibilityHint={onReact && !isReaction ? 'Long press to react' : undefined}
        style={{
          maxWidth: '82%',
          backgroundColor: outbound ? t.colors.bubbleOut : t.colors.bubbleIn,
          // No outline on either side — WhatsApp never outlines a bubble, and
          // the border was a big part of why these read as cards, not messages.
          borderWidth: 0,
          borderRadius: t.radius.lg,
          borderBottomRightRadius: outbound ? 6 : t.radius.lg,
          borderBottomLeftRadius: outbound ? t.radius.lg : 6,
          paddingHorizontal: t.space.md,
          paddingVertical: t.space.sm,
        }}
      >
        {hasMedia ? <ChatMedia message={item} conversationId={conversationId} /> : null}
        {isLocation ? <ChatLocation message={item} /> : null}
        {isContact ? <ChatContact message={item} /> : null}
        {/* A caption-less attachment stores a placeholder like "[image]" as its
            content; showing that under the picture would just be noise. */}
        {!structured || item.metadata?.caption ? (
          <Text
            variant="body"
            style={{
              color: outbound ? t.colors.bubbleOutText : t.colors.bubbleInText,
              marginTop: structured ? 6 : 0,
              fontSize: isReaction ? 30 : undefined,
              lineHeight: isReaction ? 36 : undefined,
            }}
          >
            {structured ? item.metadata?.caption : item.content}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, alignSelf: 'flex-end' }}>
          <Text
            variant="caption"
            style={{ color: outbound ? t.colors.bubbleOutText : t.colors.textMuted, opacity: 0.7 }}
          >
            {formatTime(item.createdAt)}
          </Text>
          {outbound ? <DeliveryTicks status={item.status} color={t.colors.bubbleOutText} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** "Today" / "Yesterday" / "Sat, Aug 29" — the divider between days. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function isSameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function DaySeparator({ iso }: { iso: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', marginVertical: t.space.md }}>
      <View
        style={{
          paddingHorizontal: t.space.md,
          paddingVertical: 5,
          borderRadius: t.radius.pill,
          backgroundColor: t.colors.surfaceElevated,
        }}
      >
        <Text variant="caption" weight="semi" tone="muted">
          {dayLabel(iso)}
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
  const takeOver = useTakeOver(conversationId);
  const sendMedia = useSendMedia(conversationId);
  const sendRich = useSendRich(conversationId);
  const [reactTarget, setReactTarget] = useState<Message | null>(null);

  // --- Not shipped yet. See futurefeature.md items 5 and 7. ---------------
  // Sending is wired end to end on the API (POST /conversations/:id/rich);
  // only reading the device GPS is missing, which needs expo-location.
  //
  // async function onSendLocation() {
  //   const pos = await Location.getCurrentPositionAsync({});
  //   await sendRich.mutateAsync({
  //     type: 'location',
  //     latitude: pos.coords.latitude,
  //     longitude: pos.coords.longitude,
  //   });
  // }
  //
  // async function onSendContact(name: string, phone: string) {
  //   await sendRich.mutateAsync({ type: 'contact', name, phone });
  // }
  // ------------------------------------------------------------------------

  async function onReact(emoji: string) {
    const target = reactTarget;
    setReactTarget(null);
    if (!target) return;
    try {
      await sendRich.mutateAsync({ type: 'reaction', messageId: target.id, emoji });
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      haptics.error();
      setNotice(message ?? 'Could not send that reaction.');
    }
  }


  async function onAttach() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice('Photo access is needed to send pictures.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8, // WhatsApp caps images at 5MB; re-encoding keeps us under it
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    try {
      await sendMedia.mutateAsync({
        uri: asset.uri,
        name: asset.fileName ?? `upload-${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
        mimeType: asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        caption: draft.trim() || undefined,
      });
      setDraft('');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      haptics.error();
      setNotice(message ?? 'Could not send that attachment.');
    }
  }


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
    haptics.press();
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
          /* Call button not shipped — see futurefeature.md item 8. Needs a
             custom dev build; Expo Go has no WebRTC.
          <Pressable accessibilityRole="button" accessibilityLabel="Call customer" hitSlop={8}>
            <Ionicons name="call-outline" size={20} color={t.colors.text} />
          </Pressable>
          */
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
            // Explicit handoff. Sending a message also takes over implicitly,
            // but this lets you silence the bot *before* typing a reply.
            <Pressable
              onPress={() => takeOver.mutate()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Take over from bot"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: pressed ? 0.6 : 1,
                paddingHorizontal: t.space.sm,
                paddingVertical: 6,
                borderRadius: t.radius.pill,
                backgroundColor: t.colors.surfaceSunken,
              })}
            >
              <Ionicons name="hand-left" size={14} color={t.colors.textMuted} />
              <Text variant="caption" weight="semi" tone="muted">
                Take over
              </Text>
            </Pressable>
          )
        }
      />

      {reactTarget ? (
        <Pressable
          onPress={() => setReactTarget(null)}
          accessibilityLabel="Dismiss reactions"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            backgroundColor: t.colors.scrim,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              gap: t.space.sm,
              paddingVertical: t.space.md,
              paddingHorizontal: t.space.lg,
              borderRadius: t.radius.pill,
              backgroundColor: t.colors.surfaceElevated,
              ...t.elevation(3),
            }}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => { haptics.tap(); onReact(emoji); }}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
                hitSlop={6}
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 1.25 : 1 }] })}
              >
                <Text style={{ fontSize: 28 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.chatBackground }}>
            <ActivityIndicator size="large" color={t.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={reversed}
            inverted
            keyExtractor={(m) => m.id}
            // `reversed` is newest-first and the list is inverted, so the next
            // item is the OLDER one. When it falls on a different day, this
            // message is that day's first — draw the divider above it.
            renderItem={({ item, index }) => {
              const older = reversed[index + 1];
              const startsDay = !older || !isSameDay(older.createdAt, item.createdAt);
              return (
                <View>
                  {startsDay ? <DaySeparator iso={item.createdAt} /> : null}
                  <Bubble item={item} conversationId={conversationId} onReact={setReactTarget} />
                </View>
              );
            }}
            style={{ backgroundColor: t.colors.chatBackground }}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
            onPress={onAttach}
            disabled={!withinWindow || sendMedia.isPending}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: withinWindow ? 1 : 0.4,
            }}
          >
            {sendMedia.isPending ? (
              <ActivityIndicator color={t.colors.textMuted} />
            ) : (
              <Ionicons name="add" size={26} color={t.colors.textMuted} />
            )}
          </Pressable>
          {/* Not shipped yet — see futurefeature.md items 5 and 7.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share location"
            onPress={onSendLocation}
            disabled={!withinWindow}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="location-outline" size={22} color={t.colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share a contact"
            onPress={onSendContact}
            disabled={!withinWindow}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="person-outline" size={21} color={t.colors.textMuted} />
          </Pressable>
          */}
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
