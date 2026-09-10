import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { useOrders } from '@/api/hooks';
import { Order } from '@/api/types';
import { Text, Card, Badge, Avatar, EmptyState } from '@/components/ui';
import { formatDateTime, orderStatusLabel, orderStatusTone, paymentTone } from '@/lib/format';

function OrderRow({ item }: { item: Order }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/orders/${item.id}`)}>
      <Card style={{ gap: t.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Avatar name={item.customerName} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semi" numberOfLines={1}>
              {item.customerName}
            </Text>
            <Text variant="caption" tone="muted">
              #{item.orderRef} · {String(item.totalAmount)}
            </Text>
          </View>
          <Badge label={orderStatusLabel(item.status)} tone={orderStatusTone(item.status)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="caption" tone="subtle">
            {formatDateTime(item.createdAt)}
          </Text>
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

export function OrdersList() {
  const t = useTheme();
  const { data, isLoading, isRefetching, refetch } = useOrders();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <FlatList
        data={data ?? []}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => <OrderRow item={item} />}
        contentContainerStyle={(data ?? []).length === 0 ? { flex: 1 } : { padding: t.space.lg, gap: t.space.md }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.colors.primary} />}
        ListEmptyComponent={<EmptyState icon="cart-outline" title="No orders yet" subtitle="Orders placed through your WhatsApp bot will show up here." />}
      />
    </View>
  );
}
