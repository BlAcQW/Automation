import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useAuth } from '@/auth/context';
import { useBookings } from '@/api/hooks';
import { OrdersList } from '@/features/orders/OrdersList';
import { Booking, BookingStatus } from '@/api/types';
import { Text, Card, Badge, Avatar, EmptyState } from '@/components/ui';
import { bookingStatusLabel, bookingStatusTone, formatDateTime, paymentTone } from '@/lib/format';

type Filter = 'all' | 'upcoming' | BookingStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PENDING_PAYMENT', label: 'Pending' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

function serviceName(b: Booking): string {
  return b.serviceName || b.service?.name || 'Service';
}

function BookingCard({ item }: { item: Booking }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/bookings/${item.id}`)}>
      <Card style={{ gap: t.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Avatar name={item.customerName} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semi" numberOfLines={1}>
              {item.customerName}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {serviceName(item)}
            </Text>
          </View>
          <Badge label={bookingStatusLabel(item.status)} tone={bookingStatusTone(item.status)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="caption" tone="subtle">
              {formatDateTime(item.startTime)}
            </Text>
          </View>
          {item.paymentStatus ? (
            <Badge
              label={item.paymentStatus === 'PAID' ? 'Paid' : item.paymentStatus === 'REFUNDED' ? 'Refunded' : 'Unpaid'}
              tone={paymentTone(item.paymentStatus)}
            />
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

export default function BookingsScreen() {
  const t = useTheme();
  const { tenant } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isRefetching, refetch } = useBookings();

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (filter === 'all') return list;
    if (filter === 'upcoming') return list.filter((b) => new Date(b.startTime).getTime() > Date.now());
    return list.filter((b) => b.status === filter);
  }, [data, filter]);

  // PRODUCT tenants see Orders in this tab (the tab is relabeled in _layout).
  if (tenant?.businessType === 'PRODUCT') return <OrdersList />;

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ paddingVertical: t.space.sm, borderBottomWidth: 0.5, borderBottomColor: t.colors.divider }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={{
                  paddingHorizontal: t.space.md,
                  paddingVertical: 8,
                  borderRadius: t.radius.pill,
                  backgroundColor: active ? t.colors.primary : t.colors.surfaceSunken,
                }}
              >
                <Text variant="bodySm" weight="semi" style={{ color: active ? t.colors.onPrimary : t.colors.textMuted }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <BookingCard item={item} />}
        contentContainerStyle={
          filtered.length === 0 ? { flex: 1 } : { padding: t.space.lg, gap: t.space.md }
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title="No bookings here"
            subtitle="Bookings made through your WhatsApp bot or added manually will show up here."
          />
        }
      />
    </View>
  );
}
