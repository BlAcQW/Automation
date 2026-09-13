import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from './Text';

interface LargeHeaderProps {
  title: string;
  /** Circular action buttons, right-aligned on the row above the title. */
  actions?: React.ReactNode;
  /** Search field, filter chips — anything that belongs under the title. */
  children?: React.ReactNode;
}

/**
 * Large-title screen header.
 *
 * Replaces the navigation bar on tab screens. There is no bar and no border:
 * the header sits on the same background as the content, with the title set
 * large and actions floating as round buttons above it — the arrangement the
 * operator already reads as "messaging app" from WhatsApp.
 *
 * The title is static rather than collapse-on-scroll; a collapsing title needs
 * per-screen scroll handlers and buys little at this size.
 */
export function LargeHeader({ title, actions, children }: LargeHeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top + t.space.xs,
        paddingHorizontal: t.space.lg,
        paddingBottom: t.space.sm,
        backgroundColor: t.colors.background,
        gap: t.space.sm,
      }}
    >
      {actions ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: t.space.sm }}>
          {actions}
        </View>
      ) : null}

      <Text style={{ fontFamily: t.fonts.displayExtra, fontSize: 32, lineHeight: 38, color: t.colors.text }}>
        {title}
      </Text>

      {children}
    </View>
  );
}
