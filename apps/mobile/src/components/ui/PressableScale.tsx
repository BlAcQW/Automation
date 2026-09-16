import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Resting-to-pressed scale. 0.97 reads as "it moved"; lower reads as a wobble. */
  to?: number;
}

/**
 * A Pressable that physically gives under the finger.
 *
 * An opacity dip says "registered"; a scale-down says "this is a thing you are
 * holding". It is the difference between a web link and a native control, and
 * it runs entirely on the UI thread via Reanimated, so it stays smooth even
 * while the JS thread is busy rendering the screen you're navigating to.
 */
export function PressableScale({ style, to = 0.97, onPressIn, onPressOut, children, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const spring = { damping: 18, stiffness: 320, mass: 0.6 };

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(to, spring);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, spring);
        onPressOut?.(e);
      }}
      style={[animated, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
