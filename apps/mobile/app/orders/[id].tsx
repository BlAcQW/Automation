import { Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { useOrders, useUpdateOrderStatus } from '@/api/hooks';
import { Order } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Badge, Button, EmptyState } from '@/components/ui';
import { formatDateTime, nextOrderStatus, orderStatusLabel, orderStatusTone, paymentTone } from '@/lib/format';

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.lg, paddingVertical: t.space.sm }}>
      <Text variant="bodySm" tone="muted">
        {label}
      </Text>
      <Text variant="bodySm" weight="medium" style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

export default function OrderDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useOrders();
  const order: Order | undefined = data?.find((o) => o.id === String(id));
  const updateStatus = useUpdateOrderStatus(String(id));

  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.background }}>
        <AppHeader title="Order" />
        <EmptyState icon="cart-outline" title="Order not found" subtitle="Go back and refresh." />
      </View>
    );
  }

  const next = nextOrderStatus(order.status);
  const canCancel = order.status !== 'CANCELLED' && order.status !== 'DELIVERED';

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title={`#${order.orderRef}`} subtitle={order.customerName} />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Badge label={orderStatusLabel(order.status)} tone={orderStatusTone(order.status)} />
          {order.paymentStatus ? (
            <Badge
              label={order.paymentStatus === 'PAID' ? 'Paid' : order.paymentStatus === 'REFUNDED' ? 'Refunded' : 'Unpaid'}
              tone={paymentTone(order.paymentStatus)}
            />
          ) : null}
        </View>

        {order.items && order.items.length > 0 ? (
          <Card padded style={{ gap: t.space.sm }}>
            <Text variant="caption" tone="muted">
              Items
            </Text>
            {order.items.map((it) => (
              <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="bodySm" style={{ flex: 1 }} numberOfLines={1}>
                  {it.quantity} × {it.product?.name ?? 'Item'}
                </Text>
                <Text variant="bodySm" weight="medium">
                  {String(it.unitPrice)}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card padded>
          <Row label="Total" value={String(order.totalAmount)} />
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <Row label="Placed" value={formatDateTime(order.createdAt)} />
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <Row label="Phone" value={order.customerPhone} />
          {order.deliveryAddress ? (
            <>
              <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
              <Row label="Deliver to" value={order.deliveryAddress} />
            </>
          ) : null}
        </Card>

        <View style={{ gap: t.space.sm }}>
          {next ? (
            <Button
              label={`Mark as ${orderStatusLabel(next)}`}
              icon="arrow-forward-circle-outline"
              fullWidth
              loading={updateStatus.isPending}
              onPress={() => updateStatus.mutate(next)}
            />
          ) : null}
          <Button
            label="Message customer on WhatsApp"
            icon="logo-whatsapp"
            variant="secondary"
            fullWidth
            onPress={() => Linking.openURL(`https://wa.me/${order.customerPhone.replace(/\D/g, '')}`)}
          />
          {canCancel ? (
            <Button label="Cancel order" variant="danger" fullWidth onPress={() => updateStatus.mutate('CANCELLED')} />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
