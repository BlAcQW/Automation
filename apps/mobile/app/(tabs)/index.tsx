import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/context';
import { useTheme } from '@/theme';
import { useDashboardStats, useWhatsappStatus } from '@/api/hooks';
import { Text, Card, Badge } from '@/components/ui';

type IoniconName = keyof typeof Ionicons.glyphMap;

function StatCard({ icon, label, value }: { icon: IoniconName; label: string; value: number | string }) {
  const t = useTheme();
  return (
    <Card style={{ flexGrow: 1, flexBasis: '46%', gap: t.space.sm }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: t.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={19} color={t.colors.primaryText} />
      </View>
      <Text variant="h1" weight="extra">
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </Card>
  );
}

export default function DashboardScreen() {
  const t = useTheme();
  const router = useRouter();
  const { tenant, user } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';
  const { data, isLoading, isRefetching, refetch, isError } = useDashboardStats();
  const { data: wa } = useWhatsappStatus();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  const cards: { icon: IoniconName; label: string; value: number }[] = isProduct
    ? [
        { icon: 'cash-outline', label: 'Total Sales', value: data?.totalSales ?? 0 },
        { icon: 'cart-outline', label: 'Orders', value: data?.totalOrders ?? 0 },
        { icon: 'chatbubbles-outline', label: 'Active Chats', value: data?.activeConversations ?? 0 },
        { icon: 'people-outline', label: 'Customers', value: data?.totalCustomers ?? 0 },
      ]
    : [
        { icon: 'calendar-outline', label: 'Total Bookings', value: data?.totalBookings ?? 0 },
        { icon: 'today-outline', label: "Today's Bookings", value: data?.todayBookings ?? 0 },
        { icon: 'chatbubbles-outline', label: 'Active Chats', value: data?.activeConversations ?? 0 },
        { icon: 'people-outline', label: 'Customers', value: data?.totalCustomers ?? 0 },
      ];

  const firstName = (user?.name ?? '').split(' ')[0];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
    >
      <View style={{ gap: 2 }}>
        <Text variant="bodySm" tone="muted">
          {firstName ? `Hi ${firstName},` : 'Welcome back,'}
        </Text>
        <Text variant="h1" weight="extra">
          {tenant?.name ?? 'Your business'}
        </Text>
      </View>

      {/* WhatsApp connection strip */}
      <Pressable onPress={() => router.push('/whatsapp')}>
        <Card padded style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: wa?.connected ? t.colors.successSoft : t.colors.warningSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={wa?.connected ? 'logo-whatsapp' : 'alert-circle-outline'}
              size={22}
              color={wa?.connected ? t.colors.success : t.colors.warning}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodySm" weight="semi">
              WhatsApp {wa?.connected ? 'connected' : 'not connected'}
            </Text>
            <Text variant="caption" tone="muted">
              {wa?.connected ? wa.displayNumber ?? 'Bot is live' : 'Tap to connect your number'}
            </Text>
          </View>
          <Badge label={wa?.connected ? 'Live' : 'Setup'} tone={wa?.connected ? 'success' : 'warning'} />
        </Card>
      </Pressable>

      {isError ? (
        <Text variant="bodySm" tone="danger">
          Couldn&apos;t load stats. Pull to refresh.
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md }}>
        {cards.map((c) => (
          <StatCard key={c.label} icon={c.icon} label={c.label} value={c.value} />
        ))}
      </View>
    </ScrollView>
  );
}
