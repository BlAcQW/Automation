import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/theme';
import { useUnreadCount } from '@/api/hooks';

type IoniconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IoniconName, focusedName: IoniconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? focusedName : name} size={23} color={color} />
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const { tenant } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';
  const { data: unread } = useUnreadCount();

  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: t.colors.surfaceElevated,
          borderBottomColor: t.colors.border,
          borderBottomWidth: 0.5,
          shadowColor: 'transparent',
        },
        headerTitleStyle: { color: t.colors.text, fontFamily: t.fonts.display, fontSize: 18 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.colors.background },
        tabBarStyle: {
          backgroundColor: t.colors.surfaceElevated,
          borderTopColor: t.colors.border,
          borderTopWidth: 0.5,
          height: 60,
          paddingTop: 6,
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
