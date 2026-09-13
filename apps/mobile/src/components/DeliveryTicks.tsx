import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { MessageStatus } from '@/api/types';

/**
 * WhatsApp's delivery marks, driven by Meta's status webhook.
 *
 *   (clock)  queued — sent, but Meta hasn't reported on it yet
 *   ✓        sent to WhatsApp
 *   ✓✓       delivered to the handset
 *   ✓✓ blue  read
 *   (!)      failed
 *
 * Each state means something different to the operator, so none of them is
 * guessed: a message with no status yet shows a clock, not a tick.
 */
export function DeliveryTicks({ status, color }: { status?: MessageStatus | null; color: string }) {
  const t = useTheme();

  if (status === 'FAILED') {
    return (
      <Ionicons name="alert-circle" size={13} color={t.colors.danger} accessibilityLabel="Failed to send" />
    );
  }

  if (!status) {
    return (
      <Ionicons name="time-outline" size={12} color={color} style={{ opacity: 0.6 }} accessibilityLabel="Sending" />
    );
  }

  const read = status === 'READ';
  const double = read || status === 'DELIVERED';
  const tint = read ? t.colors.info : color;

  return (
    <View
      style={{ flexDirection: 'row', width: double ? 17 : 12 }}
      accessibilityLabel={read ? 'Read' : double ? 'Delivered' : 'Sent'}
    >
      <Ionicons name="checkmark" size={13} color={tint} style={{ opacity: read ? 1 : 0.75 }} />
      {double ? (
        <Ionicons
          name="checkmark"
          size={13}
          color={tint}
          style={{ marginLeft: -8, opacity: read ? 1 : 0.75 }}
        />
      ) : null}
    </View>
  );
}
