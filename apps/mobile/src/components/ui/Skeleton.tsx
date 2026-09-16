import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';

/**
 * Loading placeholders that mirror the layout they stand in for.
 *
 * A spinner on a blank screen says "wait"; a skeleton the same shape as the
 * content says "here is what's coming", and the content then fades in over it
 * instead of snapping into a void. The rule is that the skeleton must match the
 * real row's dimensions exactly — otherwise it trades a spinner for layout
 * shift, which is worse.
 *
 * Pulses on the native thread via Reanimated. Shape carries the effect; the
 * pulse is deliberately faint.
 */

function usePulse() {
  const opacity = useSharedValue(0.55);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

interface BoneProps {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}

/** One placeholder block. */
export function Bone({ width = '100%', height, radius, style }: BoneProps) {
  const t = useTheme();
  const pulse = usePulse();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius ?? height / 2, backgroundColor: t.colors.surfaceSunken },
        pulse,
        style,
      ]}
    />
  );
}

/** Mirrors ConversationRow in (tabs)/chats.tsx: 56pt avatar, title, 2-line preview. */
export function ChatRowSkeleton() {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.sm + 2,
      }}
    >
      <Bone width={56} height={56} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Bone width="45%" height={14} />
          <Bone width={44} height={11} />
        </View>
        <Bone width="88%" height={12} />
        <Bone width="62%" height={12} />
      </View>
    </View>
  );
}

/** A generic card-shaped placeholder for list screens built on Card. */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.colors.surface,
        borderRadius: t.radius.lg,
        padding: t.space.lg,
        gap: 10,
      }}
    >
      <Bone width="55%" height={15} />
      {Array.from({ length: lines }).map((_, i) => (
        <Bone key={i} width={i === lines - 1 ? '40%' : '80%'} height={12} />
      ))}
    </View>
  );
}

/** Mirrors BookingCard in (tabs)/bookings.tsx: 40pt avatar, name + caption, badge, footer row. */
export function BookingCardSkeleton() {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.colors.surface,
        borderRadius: t.radius.lg,
        padding: t.space.lg,
        gap: t.space.md,
        marginBottom: t.space.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <Bone width={40} height={40} />
        <View style={{ flex: 1, gap: 7 }}>
          <Bone width="52%" height={14} />
          <Bone width="72%" height={11} />
        </View>
        <Bone width={64} height={20} radius={10} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Bone width="38%" height={11} />
        <Bone width="24%" height={11} />
      </View>
    </View>
  );
}

/** Repeat a skeleton to fill the viewport. */
export function SkeletonList({ count = 8, children }: { count?: number; children: React.ReactNode }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i}>{children}</View>
      ))}
    </View>
  );
}
