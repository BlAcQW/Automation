import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/theme';
import { useUnreadCount } from '@/api/hooks';
import { TAB_BAR_HEIGHT, TAB_BAR_MARGIN, TAB_BAR_RADIUS } from '@/lib/layout';

type IoniconName = keyof typeof Ionicons.glyphMap;

// expo-router 57 widened tabBarIcon's `color` from string to ColorValue, which
// also covers platform colours. Ionicons accepts the same union, so this passes
// straight through.
function tabIcon(name: IoniconName, focusedName: IoniconName) {
  return ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Ionicons name={focused ? focusedName : name} size={23} color={color} />
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tenant } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';
  const { data: unread } = useUnreadCount();
  const isDark = t.scheme === 'dark';

  /**
   * Frosted-glass tab bar: a blurred pill floating over the content rather than
   * an opaque strip pinned to the edge. The blur alone reads washed-out, so a
   * translucent scrim sits on top of it to keep icon contrast, and a hairline
   * border defines the pill against light backgrounds.
   */
  function GlassTabBar() {
    return (
      <View style={StyleSheet.absoluteFill}>
        <BlurView
          intensity={isDark ? 60 : 80}
          tint={isDark ? 'dark' : 'light'}
          // Android has no native backdrop blur; this opts into Expo's
          // implementation instead of silently falling back to a flat view.
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={[StyleSheet.absoluteFill, { borderRadius: TAB_BAR_RADIUS }]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: TAB_BAR_RADIUS,
              backgroundColor: isDark ? 'rgba(18,18,20,0.55)' : 'rgba(255,255,255,0.55)',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            },
          ]}
        />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        // Tab screens draw their own large-title header (ui/LargeHeader) instead
        // of a navigation bar — no bar, no border, title set large.
        headerShown: false,
        sceneStyle: { backgroundColor: t.colors.background },
        tabBarBackground: GlassTabBar,
        tabBarStyle: {
          position: 'absolute',
          left: TAB_BAR_MARGIN,
          right: TAB_BAR_MARGIN,
          bottom: Math.max(insets.bottom, TAB_BAR_MARGIN - 4),
          height: TAB_BAR_HEIGHT,
          borderRadius: TAB_BAR_RADIUS,
          // The pill is drawn by tabBarBackground, so the bar itself is bare.
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          paddingTop: 8,
          paddingBottom: 8,
          shadowColor: t.colors.shadow,
          shadowOpacity: isDark ? 0.45 : 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarLabelStyle: { fontFamily: t.fonts.bodyMedium, fontSize: 11 },
        tabBarActiveTintColor: t.colors.primaryText,
        tabBarInactiveTintColor: t.colors.textSubtle,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Overview', headerTitle: 'Overview', tabBarIcon: tabIcon('grid-outline', 'grid') }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: isProduct ? 'Orders' : 'Bookings',
          tabBarIcon: tabIcon('calendar-outline', 'calendar'),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: tabIcon('chatbubble-outline', 'chatbubble'),
          tabBarBadge: unread && unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: t.colors.primary, color: t.colors.onPrimary, fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          title: isProduct ? 'Products' : 'Services',
          tabBarIcon: tabIcon('pricetags-outline', 'pricetags'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: tabIcon('ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle') }}
      />
    </Tabs>
  );
}
