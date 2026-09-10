import { Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { useBookings, useInitBookingPayment } from '@/api/hooks';
import { Booking } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import { Text, Card, Badge, Button, EmptyState } from '@/components/ui';
import { bookingStatusLabel, bookingStatusTone, formatDateTime, paymentTone } from '@/lib/format';

function serviceName(b: Booking): string {
  return b.serviceName || b.service?.name || 'Service';
}

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

export default function BookingDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useBookings();
  const booking = data?.find((b) => b.id === String(id));
  const initPayment = useInitBookingPayment(String(id));

  if (!booking) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.background }}>
        <AppHeader title="Booking" />
        <EmptyState icon="calendar-outline" title="Booking not found" subtitle="It may have been removed. Go back and refresh." />
      </View>
    );
  }

  const canPay = booking.paymentStatus === 'UNPAID' || booking.status === 'PENDING_PAYMENT';

  async function onPay() {
    if (booking!.paymentAuthorizationUrl) {
      Linking.openURL(booking!.paymentAuthorizationUrl);
      return;
    }
    const res = await initPayment.mutateAsync().catch(() => null);
    if (res?.authorizationUrl) Linking.openURL(res.authorizationUrl);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AppHeader title={booking.customerName} subtitle={`Ref ${booking.bookingReference}`} />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Badge label={bookingStatusLabel(booking.status)} tone={bookingStatusTone(booking.status)} />
          {booking.paymentStatus ? (
            <Badge
              label={booking.paymentStatus === 'PAID' ? 'Paid' : booking.paymentStatus === 'REFUNDED' ? 'Refunded' : 'Unpaid'}
              tone={paymentTone(booking.paymentStatus)}
            />
          ) : null}
        </View>

        <Card padded>
          <Row label="Service" value={serviceName(booking)} />
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <Row label="When" value={formatDateTime(booking.startTime)} />
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <Row label="Customer" value={booking.customerName} />
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <Row label="Phone" value={booking.customerPhone} />
          <View style={{ height: 0.5, backgroundColor: t.colors.divider }} />
          <Row label="Reference" value={booking.bookingReference} />
        </Card>

        {booking.notes ? (
          <Card padded style={{ gap: t.space.xs }}>
            <Text variant="caption" tone="muted">
              Notes
            </Text>
            <Text variant="bodySm">{booking.notes}</Text>
          </Card>
        ) : null}

        <View style={{ gap: t.space.sm }}>
          <Button
            label="Message customer on WhatsApp"
            icon="logo-whatsapp"
            variant="secondary"
            fullWidth
            onPress={() => Linking.openURL(`https://wa.me/${booking.customerPhone.replace(/\D/g, '')}`)}
          />
          {canPay ? (
            <Button
              label={booking.paymentAuthorizationUrl ? 'Open payment link' : 'Create payment link'}
              icon="card-outline"
              fullWidth
              loading={initPayment.isPending}
              onPress={onPay}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
