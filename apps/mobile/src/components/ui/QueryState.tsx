import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './Text';

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  /** True when the request succeeded but returned nothing. */
  isEmpty?: boolean;
  onRetry?: () => void;
  /** Shown only when isEmpty — never when the request failed. */
  empty?: React.ReactNode;
  /**
   * Layout-shaped placeholder for the loading state. Prefer this over the
   * default spinner: it tells the eye what is coming and content fades in
   * over it instead of snapping into a void.
   */
  skeleton?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The three outcomes of a query, told apart.
 *
 * Every screen used to branch on `isLoading` alone. React Query sets
 * `isLoading: false` and `data: undefined` when a request FAILS, so the render
 * fell through to the empty state — and a business whose API was unreachable
 * was told "No conversations yet" rather than "couldn't connect". They had
 * every reason to think their data was gone.
 *
 * Failure and emptiness are different facts and must never share a screen.
 */
export function QueryState({ isLoading, isError, isEmpty, onRetry, empty, skeleton, children }: QueryStateProps) {
  const t = useTheme();

  if (isLoading) {
    if (skeleton) return <>{skeleton}</>;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.md }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space.sm,
          padding: t.space.xl,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={40} color={t.colors.textSubtle} />
        <Text variant="body" weight="semi" center>
          Can&apos;t reach the server
        </Text>
        <Text variant="bodySm" tone="muted" center>
          Your data is safe — check your connection and try again.
        </Text>
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={({ pressed }) => ({
              marginTop: t.space.sm,
              paddingHorizontal: t.space.lg,
              paddingVertical: 10,
              borderRadius: t.radius.pill,
              backgroundColor: t.colors.primary,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text variant="bodySm" weight="semi" tone="onPrimary">
              Try again
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (isEmpty && empty) return <>{empty}</>;

  return <>{children}</>;
}
