import { Suspense } from 'react';
import { PaymentResult } from '@/components/pay/payment-result';

/**
 * Public payment-confirmation page for booking deposits. Paystack redirects
 * the customer here after they pay (`/pay/booking?reference=...`). Lives
 * outside `/bookings` so it does NOT inherit the auth-gated dashboard layout.
 */
export default function PayBookingPage() {
    return (
        <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
            <PaymentResult kind="booking" />
        </Suspense>
    );
}
