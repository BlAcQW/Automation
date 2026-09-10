import { BookingStatus, OrderStatus, PaymentStatus } from '@/api/types';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const BOOKING_TONE: Record<BookingStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'success',
  COMPLETED: 'primary',
  CANCELLED: 'danger',
  NO_SHOW: 'neutral',
};

export function bookingStatusLabel(s: BookingStatus): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function bookingStatusTone(s: BookingStatus): Tone {
  return BOOKING_TONE[s] ?? 'neutral';
}

export function paymentTone(p?: PaymentStatus): Tone {
  if (p === 'PAID') return 'success';
  if (p === 'REFUNDED') return 'info';
  return 'warning';
}

const ORDER_TONE: Record<OrderStatus, Tone> = {
  PENDING: 'warning',
  CONFIRMED: 'primary',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

export function orderStatusLabel(s: OrderStatus): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export function orderStatusTone(s: OrderStatus): Tone {
  return ORDER_TONE[s] ?? 'neutral';
}

// The natural next fulfilment step for a status (null when terminal).
export function nextOrderStatus(s: OrderStatus): OrderStatus | null {
  const flow: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
  const i = flow.indexOf(s);
  if (i === -1 || i === flow.length - 1) return null;
  return flow[i + 1];
}
