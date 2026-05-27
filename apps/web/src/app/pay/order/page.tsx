import { Suspense } from 'react';
import { PaymentResult } from '@/components/pay/payment-result';

/**
 * Public payment-confirmation page for orders. Paystack redirects the customer
 * here after they pay (`/pay/order?reference=...`). Lives outside `/orders` so
 * it does NOT inherit the auth-gated dashboard layout.
 */
export default function PayOrderPage() {
    return (
        <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
            <PaymentResult kind="order" />
        </Suspense>
    );
}
