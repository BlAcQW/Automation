import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';

/**
 * Foreground ("in-app") notifications.
 *
 * The OS only draws a banner for a push while the app is backgrounded. When the
 * user is already looking at the app, events arriving over the realtime socket
 * surface here instead — a frosted banner that drops in from the top, matching
 * the glass tab bar, and deep-links to the relevant screen when tapped.
 */
export interface InAppNotice {
  /** De-dupes repeats: the same key won't re-show while already on screen. */
  key?: string;
  title: string;
  body?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Route pushed when the banner is tapped, e.g. '/(tabs)/bookings'. */
  href?: string;
}

type Notify = (notice: InAppNotice) => void;

const NoticeContext = createContext<Notify>(() => undefined);

/** Show a foreground banner. Safe to call from anywhere under the provider. */
export function useNotice(): Notify {
  return useContext(NoticeContext);
}

const VISIBLE_MS = 4800;
const HIDDEN_OFFSET = -160;

export function InAppNoticeProvider({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = t.scheme === 'dark';

  const [notice, setNotice] = useState<InAppNotice | null>(null);
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentKey = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    Animated.timing(translateY, {
      toValue: HIDDEN_OFFSET,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setNotice(null);
        currentKey.current = null;
      }
    });
  }, [clearTimer, translateY]);

  const notify = useCallback<Notify>(
    (next) => {
      // Ignore a repeat of what's already showing (the socket can fan out
      // several events for one underlying change).
      if (next.key && next.key === currentKey.current) return;

      clearTimer();
      currentKey.current = next.key ?? null;
      setNotice(next);

      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      timer.current = setTimeout(hide, VISIBLE_MS);
    },
    [clearTimer, hide, translateY],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const onPress = useCallback(() => {
    const href = notice?.href;
    hide();
    if (href) router.push(href as never);
  }, [notice?.href, hide, router]);

  return (
    <NoticeContext.Provider value={notify}>
      {children}

      {notice ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { top: insets.top + 8, transform: [{ translateY }] },
          ]}
        >
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${notice.title}${notice.body ? `. ${notice.body}` : ''}`}
            style={[styles.card, { shadowColor: t.colors.shadow, shadowOpacity: isDark ? 0.5 : 0.16 }]}
          >
            <BlurView
              intensity={isDark ? 60 : 85}
              tint={isDark ? 'dark' : 'light'}
              experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark ? 'rgba(18,18,20,0.55)' : 'rgba(255,255,255,0.6)',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                  borderRadius: 20,
                },
              ]}
            />

            <View style={[styles.iconBubble, { backgroundColor: t.colors.primary }]}>
              <Ionicons name={notice.icon ?? 'notifications'} size={17} color={t.colors.onPrimary} />
            </View>

            <View style={styles.copy}>
              <Text variant="bodySm" weight="semi" numberOfLines={1}>
                {notice.title}
              </Text>
              {notice.body ? (
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {notice.body}
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={hide}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Dismiss notification"
              style={styles.close}
            >
              <Ionicons name="close" size={16} color={t.colors.textSubtle} />
            </Pressable>
          </Pressable>
        </Animated.View>
      ) : null}
    </NoticeContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 100,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    overflow: 'hidden',
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 1 },
  close: { padding: 4 },
});
