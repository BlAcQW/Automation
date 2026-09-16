import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getAccessToken } from '@/auth/store';
import { API_BASE_URL } from '@/lib/config';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';
import type { MediaKind, Message } from '@/api/types';

/**
 * Attachments on a message.
 *
 * Stored media sits behind an authenticated, tenant-scoped route, so the URL
 * alone isn't enough. React Native's Image and both Expo players accept request
 * headers, which is why the token is read up front rather than put in the URL
 * where it would leak into logs.
 */
function useMediaSource(messageId: string, conversationId: string) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAccessToken()
      .then((v) => active && setToken(v ?? null))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const uri = `${API_BASE_URL}/conversations/${conversationId}/media/${messageId}`;
  return { uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined, ready: !!token };
}

function Shell({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: 6 }}>{children}</View>;
}

function Unavailable({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
      <Ionicons name="alert-circle-outline" size={16} color={t.colors.textSubtle} />
      <Text variant="caption" tone="subtle">
        {label}
      </Text>
    </View>
  );
}

function VideoBubble({ uri, headers }: { uri: string; headers?: Record<string, string> }) {
  const t = useTheme();
  const player = useVideoPlayer({ uri, headers }, (p) => {
    p.loop = false;
  });

  return (
    <VideoView
      player={player}
      nativeControls
      style={{ width: 240, height: 180, borderRadius: t.radius.md, backgroundColor: '#000' }}
      contentFit="contain"
    />
  );
}

function AudioBubble({ uri, headers, voice }: { uri: string; headers?: Record<string, string>; voice?: boolean }) {
  const t = useTheme();
  const player = useAudioPlayer({ uri, headers });
  const status = useAudioPlayerStatus(player);
  const playing = status?.playing ?? false;

  const total = status?.duration ?? 0;
  const done = status?.currentTime ?? 0;
  const progress = total > 0 ? Math.min(1, done / total) : 0;
  const secs = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 4 }}>
      <Pressable
        onPress={() => (playing ? player.pause() : player.play())}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        hitSlop={8}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.colors.primary,
        }}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={17} color={t.colors.onPrimary} />
      </Pressable>

      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: t.colors.surfaceSunken }}>
          <View
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              borderRadius: 2,
              backgroundColor: t.colors.primary,
            }}
          />
        </View>
        <Text variant="caption" tone="muted">
          {voice ? 'Voice note' : 'Audio'} · {total > 0 ? secs(total - done) : '0:00'}
        </Text>
      </View>
    </View>
  );
}

export function ChatMedia({ message, conversationId }: { message: Message; conversationId: string }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const { uri, headers, ready } = useMediaSource(message.id, conversationId);

  const kind: MediaKind =
    message.metadata?.kind ??
    (message.messageType?.toLowerCase() as MediaKind) ??
    'document';

  // Inbound media is stored as a Meta id only — the bytes are never downloaded,
  // so there is nothing to render. Say so rather than showing a broken frame.
  if (message.metadata?.inboundPending) {
    return <Unavailable label={`${kind} from customer (not downloaded)`} />;
  }

  if (failed) return <Unavailable label="Attachment unavailable" />;

  if (kind === 'document') {
    return (
      <Pressable
        onPress={() => Linking.openURL(uri).catch(() => setFailed(true))}
        accessibilityRole="button"
        accessibilityLabel={`Open ${message.metadata?.filename ?? 'document'}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minWidth: 180 }}
      >
        <Ionicons name="document-text" size={22} color={t.colors.textMuted} />
        <Text variant="bodySm" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
          {message.metadata?.filename ?? 'Document'}
        </Text>
      </Pressable>
    );
  }

  if (!ready) {
    return (
      <View style={{ height: 140, width: 200, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.colors.textSubtle} />
      </View>
    );
  }

  if (kind === 'video') return <Shell><VideoBubble uri={uri} headers={headers} /></Shell>;
  if (kind === 'audio') return <AudioBubble uri={uri} headers={headers} voice={message.metadata?.voice} />;

  // Stickers are transparent PNG/WebP — no background, no rounding, smaller.
  const sticker = kind === 'sticker';
  return (
    <Image
      source={{ uri, headers }}
      onError={() => setFailed(true)}
      accessibilityLabel={message.metadata?.caption || (sticker ? 'Sticker' : 'Photo')}
      style={{
        width: sticker ? 130 : 220,
        height: sticker ? 130 : 220,
        borderRadius: sticker ? 0 : t.radius.md,
        backgroundColor: sticker ? 'transparent' : t.colors.surfaceSunken,
      }}
      resizeMode={sticker ? 'contain' : 'cover'}
    />
  );
}
