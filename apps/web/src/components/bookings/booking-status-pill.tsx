'use client';

import { StatusPill } from '@bookingflow/ui';

export type BookingStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

/** Booking status in plain words: icon + word + colour, never colour alone. */
export function BookingStatusPill({ status, size = 'sm' }: { status: BookingStatus; size?: 'sm' | 'md' }) {
    switch (status) {
        case 'CONFIRMED':
            return <StatusPill status="confirmed" size={size} />;
        case 'COMPLETED':
            return <StatusPill status="completed" label="Done" size={size} />;
        case 'CANCELLED':
            return <StatusPill status="cancelled" size={size} />;
        case 'NO_SHOW':
            return <StatusPill status="no_show" label="Didn't come" size={size} />;
        default:
            return <StatusPill status="pending" label="Awaiting payment" size={size} />;
    }
}
