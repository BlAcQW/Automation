import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useAuth } from '@/auth/context';

// Emoji tab icons keep the scaffold dependency-free; swap for @expo/vector-icons later.
function icon(glyph: string) {
  return ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { tenant } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0b0f14' },
        headerTitleStyle: { color: '#f9fafb' },
        tabBarStyle: { backgroundColor: '#0b0f14', borderTopColor: '#1c232c' },
        tabBarActiveTintColor: '#25D366',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen
        name="bookings"
        options={{ title: isProduct ? 'Orders' : 'Bookings', tabBarIcon: icon('📅') }}
      />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('💬') }} />
      <Tabs.Screen
        name="services"
        options={{ title: isProduct ? 'Products' : 'Services', tabBarIcon: icon('🧰') }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('⚙️') }} />
    </Tabs>
  );
}
