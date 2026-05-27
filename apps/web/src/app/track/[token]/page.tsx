'use client';

import { useEffect, useState } from 'react';

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
        <main className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-10">
            <div className="w-full max-w-md">
                {loading && (
                    <div className="text-center text-slate-500 py-20">Loading your order…</div>
                )}

                {error === 'not_found' && (
                    <Card>
                        <h1 className="text-lg font-semibold text-slate-900">Order not found</h1>
                        <p className="text-sm text-slate-500 mt-2">
                            This tracking link is invalid or has expired. Check the link in your message and try again.
                        </p>
                    </Card>
                )}
                {error === 'error' && (
                    <Card>
                        <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
                        <p className="text-sm text-slate-500 mt-2">Please try again in a moment.</p>
                    </Card>
                )}

                {data && (
                    <Card>
                        <p className="text-xs uppercase tracking-wide text-slate-400">{data.businessName}</p>
                        <h1 className="text-xl font-semibold text-slate-900 mt-1">
                            Order {data.orderRef}
                        </h1>

                        {data.status === 'CANCELLED' ? (
                            <div className="mt-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
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
                                                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ' +
                                                        (reached
                                                            ? 'bg-emerald-500 text-white'
                                                            : 'bg-slate-200 text-slate-400')
                                                    }
                                                >
                                                    {reached ? '✓' : i + 1}
                                                </span>
                                                {!isLast && (
                                                    <span
                                                        className={
                                                            'w-0.5 flex-1 min-h-[28px] ' +
                                                            (i < currentStep(data) ? 'bg-emerald-500' : 'bg-slate-200')
                                                        }
                                                    />
                                                )}
                                            </div>
                                            <span
                                                className={
                                                    'pb-6 text-sm ' +
                                                    (reached ? 'text-slate-900 font-medium' : 'text-slate-400')
                                                }
                                            >
                                                {label}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        <div className="mt-4 border-t border-slate-100 pt-4">
                            <p className="text-sm font-medium text-slate-700 mb-2">Items</p>
                            <ul className="space-y-1.5">
                                {data.items.map((it, idx) => (
                                    <li key={idx} className="flex justify-between text-sm text-slate-600">
                                        <span>{it.quantity}× {it.name}</span>
                                        <span>{(it.quantity * it.unitPrice).toFixed(2)}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="flex justify-between mt-3 pt-3 border-t border-slate-100 font-semibold text-slate-900">
                                <span>Total</span>
                                <span>{data.totalAmount.toFixed(2)}</span>
                            </div>
                        </div>

                        <p className="text-xs text-slate-400 mt-5">
                            Last updated {new Date(data.updatedAt).toLocaleString()}
                        </p>
                    </Card>
                )}
            </div>
        </main>
    );
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">{children}</div>
    );
}
