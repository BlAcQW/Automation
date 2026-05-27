// Shared helpers for the Paystack-driven payment surfaces on the dashboard.

export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';

/**
 * Tailwind classes for a payment-status badge. Used by both the orders and
 * the bookings tables so the colour signal is consistent.
 */
export function paymentBadgeClass(status: PaymentStatus): string {
    switch (status) {
        case 'PAID':
            return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
        case 'REFUNDED':
            return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
        default:
            return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    }
}
