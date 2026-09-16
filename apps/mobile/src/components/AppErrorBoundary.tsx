import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';

interface State {
  error: Error | null;
}

/**
 * Catches render errors anywhere below it.
 *
 * Without this, one malformed API response takes the whole app to a blank
 * screen with no way back — the user force-quits and assumes it's broken.
 *
 * Deliberately a class: React only exposes componentDidCatch to class
 * components, and deliberately theme-free, because a crash inside the theme
 * provider would otherwise take this down with it.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Render crash:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 10,
          backgroundColor: '#000000',
        }}
      >
        <Ionicons name="warning-outline" size={40} color="#8E8E93" />
        <Text variant="body" weight="semi" center style={{ color: '#FFFFFF' }}>
          Something went wrong
        </Text>
        <Text variant="bodySm" center style={{ color: '#8E8E93' }}>
          The screen failed to load. Your data is safe — nothing was lost.
        </Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => ({
            marginTop: 12,
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: '#25D366',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text variant="bodySm" weight="semi" style={{ color: '#062017' }}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
}
