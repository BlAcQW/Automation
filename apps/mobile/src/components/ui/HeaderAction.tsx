import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

interface HeaderActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  /** Screen-reader label — the button is icon-only. */
  label: string;
  onPress: () => void;
  /** Filled circle for the screen's primary action; plain glyph otherwise. */
  filled?: boolean;
}

/**
 * Icon button for a screen header's right slot.
 *
 * Primary "create" actions live up here rather than in a floating button at the
 * bottom: the glass tab bar now floats over the bottom of every tab screen, so
 * a FAB there would sit underneath it. It also matches the compose affordance
 * users already know from WhatsApp, which puts its + in the top-right.
 */
export function HeaderAction({ icon, label, onPress, filled = true }: HeaderActionProps) {
  const t = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // 34pt visual, but hitSlop brings the touch target to ~44pt (HIG minimum).
      hitSlop={10}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? t.colors.primary : 'transparent',
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Ionicons
        name={icon}
        size={filled ? 21 : 22}
        color={filled ? t.colors.onPrimary : t.colors.text}
      />
    </Pressable>
  );
}
