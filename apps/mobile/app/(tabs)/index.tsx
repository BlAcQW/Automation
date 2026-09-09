import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/auth/context';

interface DashboardStats {
  totalBookings?: number;
  todayBookings?: number;
  activeConversations?: number;
  totalCustomers?: number;
  totalSales?: number;
  totalOrders?: number;
}

function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await api.get('/dashboard/stats');
      return res.data;
    },
    refetchInterval: 60_000,
  });
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { tenant } = useAuth();
  const isProduct = tenant?.businessType === 'PRODUCT';
  const { data, isLoading, isRefetching, refetch, isError } = useDashboardStats();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#25D366" />
      </View>
    );
  }

  const cards = isProduct
    ? [
        { label: 'Total Sales', value: data?.totalSales ?? 0 },
        { label: 'Orders', value: data?.totalOrders ?? 0 },
        { label: 'Active Chats', value: data?.activeConversations ?? 0 },
        { label: 'Customers', value: data?.totalCustomers ?? 0 },
      ]
    : [
        { label: 'Total Bookings', value: data?.totalBookings ?? 0 },
        { label: "Today's Bookings", value: data?.todayBookings ?? 0 },
        { label: 'Active Chats', value: data?.activeConversations ?? 0 },
        { label: 'Customers', value: data?.totalCustomers ?? 0 },
      ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#25D366" />}
    >
      <Text style={styles.greeting}>{tenant?.name ?? 'Your business'}</Text>
      {isError && <Text style={styles.error}>Couldn&apos;t load stats. Pull to refresh.</Text>}
      <View style={styles.grid}>
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0f14' },
  content: { padding: 16 },
  greeting: { color: '#f9fafb', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    backgroundColor: '#151b23',
    borderColor: '#232b36',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    width: '47%',
  },
  cardValue: { color: '#25D366', fontSize: 28, fontWeight: '800' },
  cardLabel: { color: '#9ca3af', fontSize: 13, marginTop: 6 },
  error: { color: '#f87171', marginBottom: 12 },
});
