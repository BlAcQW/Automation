'use client';

import { StatusPill } from '@bookingflow/ui';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export type OrderPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
    PENDING: 'New',
    CONFIRMED: 'Confirmed',
    PROCESSING: 'Getting ready',
    SHIPPED: 'On the way',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
};

/** Where the order is: icon + word + colour. */
export function OrderStatusPill({ status, size = 'sm' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
    const tone = status === 'CANCELLED' ? 'error'
        : status === 'PENDING' || status === 'PROCESSING' ? 'warning'
        : 'success';
    return <StatusPill status={status} tone={tone} label={ORDER_STATUS_LABEL[status] ?? status} size={size} />;
}

/** Paid (green tick) · Not paid (gold clock) · Refunded (grey). */
export function PaymentPill({ status, size = 'sm' }: { status: OrderPaymentStatus; size?: 'sm' | 'md' }) {
    if (status === 'PAID') return <StatusPill status="paid" label="Paid" size={size} />;
    if (status === 'REFUNDED') return <StatusPill status="refunded" label="Refunded" size={size} />;
    return <StatusPill status="unpaid" label="Not paid" size={size} />;
}
