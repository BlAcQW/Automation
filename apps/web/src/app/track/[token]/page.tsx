'use client';

import { useEffect, useState } from 'react';
import {
    PaperCard,
    PublicPage,
    SummaryCard,
    publicBody,
    publicEyebrow,
    publicFine,
    publicTitle,
} from '@/components/pay/public-shell';

interface TrackItem {
    name: string;
    quantity: number;
    unitPrice: number;
}
interface TrackData {
    orderRef: string;
    status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
    paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
    totalAmount: number;
    businessName: string;
    placedAt: string;
    updatedAt: string;
    items: TrackItem[];
}

const STEPS = ['Placed', 'Paid', 'Shipped', 'Delivered'] as const;

/** Index of the furthest reached step (-1 if cancelled). */
function currentStep(d: TrackData): number {
    if (d.status === 'CANCELLED') return -1;
    if (d.status === 'DELIVERED') return 3;
    if (d.status === 'SHIPPED') return 2;
    if (d.paymentStatus === 'PAID') return 1;
    return 0;
}

export default function TrackOrderPage({ params }: { params: { token: string } }) {
    const [data, setData] = useState<TrackData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/public/track/${params.token}`)
            .then(async (r) => {
                if (r.status === 404) throw new Error('not_found');
                if (!r.ok) throw new Error('error');
                return r.json();
            })
            .then((d: TrackData) => setData(d))
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, [params.token]);

    return (
        <PublicPage>
            {loading && (
                <div className={`text-center py-20 ${publicBody}`}>Loading your order…</div>
            )}

            {error === 'not_found' && (
                <PaperCard>
                    <h1 className={publicTitle}>Order not found</h1>
                    <p className={`mt-3 ${publicBody}`}>
                        This tracking link is invalid or has expired. Check the link in your message and try again.
                    </p>
                </PaperCard>
            )}
            {error === 'error' && (
                <PaperCard>
                    <h1 className={publicTitle}>Something went wrong</h1>
                    <p className={`mt-3 ${publicBody}`}>Please try again in a moment.</p>
                </PaperCard>
            )}

            {data && (
                <PaperCard>
                    <p className={publicEyebrow}>{data.businessName}</p>
                    <h1 className={`${publicTitle} mt-2`}>
                        Order {data.orderRef}
                    </h1>

                    {data.status === 'CANCELLED' ? (
                        <div className="mt-5 rounded-[5px] border border-[#B03A2E]/25 bg-[#B03A2E]/[.06] px-4 py-3 text-[14px] text-[#B03A2E]">
                            This order has been cancelled.
                        </div>
                    ) : (
                        <ol className="mt-6 space-y-0">
                            {STEPS.map((label, i) => {
                                const reached = i <= currentStep(data);
                                const isLast = i === STEPS.length - 1;
                                return (
                                    <li key={label} className="flex gap-3">
                                        <div className="flex flex-col items-center">
                                            <span
                                                className={
                                                    'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums ' +
                                                    (reached
                                                        ? 'bg-forest-brand text-[#FBFAF7]'
                                                        : 'bg-forest-ink/[.08] text-[#7F857B]')
                                                }
                                            >
                                                {reached ? '✓' : i + 1}
                                            </span>
                                            {!isLast && (
                                                <span
                                                    className={
                                                        'w-px flex-1 min-h-[28px] ' +
                                                        (i < currentStep(data) ? 'bg-forest-brand' : 'bg-forest-ink/[.12]')
                                                    }
                                                />
                                            )}
                                        </div>
                                        <span
                                            className={
                                                'pb-6 text-[14px] ' +
                                                (reached ? 'text-forest-ink font-medium' : 'text-[#7F857B]')
                                            }
                                        >
                                            {label}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    )}

                    <SummaryCard className="mt-2">
                        <p className="text-[12px] font-medium text-forest-cream/60 mb-3">Items</p>
                        <ul className="space-y-1.5">
                            {data.items.map((it, idx) => (
                                <li key={idx} className="flex justify-between gap-4 text-[14px] text-forest-cream/80">
                                    <span>{it.quantity}× {it.name}</span>
                                    <span className="tabular-nums">{(it.quantity * it.unitPrice).toFixed(2)}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="flex items-baseline justify-between mt-4 pt-3 border-t border-forest-cream/10">
                            <span className="text-[13px] text-forest-cream/70">Total</span>
                            <span className="text-[24px] font-light tracking-[-0.03em] tabular-nums">{data.totalAmount.toFixed(2)}</span>
                        </div>
                    </SummaryCard>

                    <p className={`mt-5 ${publicFine}`}>
                        Last updated {new Date(data.updatedAt).toLocaleString()}
                    </p>
                </PaperCard>
            )}
        </PublicPage>
    );
}
