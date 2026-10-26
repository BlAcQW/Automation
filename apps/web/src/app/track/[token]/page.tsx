'use client';

import { useEffect, useState } from 'react';
import { Check, CloudOff, SearchX } from 'lucide-react';
import { Skeleton, SkeletonLine, StatusPill, cn, formatCedi } from '@bookingflow/ui';
import {
    BusinessHero,
    PublicCard,
    PublicPage,
    formatWhen,
    publicBody,
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

const STEPS = ['Order placed', 'Paid', 'On its way', 'Delivered'] as const;

/** Index of the furthest reached step (-1 if cancelled). */
function currentStep(d: TrackData): number {
    if (d.status === 'CANCELLED') return -1;
    if (d.status === 'DELIVERED') return 3;
    if (d.status === 'SHIPPED') return 2;
    if (d.paymentStatus === 'PAID') return 1;
    return 0;
}

const PAYMENT_PILL: Record<TrackData['paymentStatus'], { status: string; label: string }> = {
    PAID: { status: 'paid', label: 'Paid' },
    UNPAID: { status: 'pending', label: 'Not paid yet' },
    REFUNDED: { status: 'refunded', label: 'Refunded' },
};

const ORDER_PILL: Record<TrackData['status'], { status: string; label: string }> = {
    PENDING: { status: 'pending', label: 'Order placed' },
    CONFIRMED: { status: 'confirmed', label: 'Confirmed' },
    PROCESSING: { status: 'processing', label: 'Being prepared' },
    SHIPPED: { status: 'pending', label: 'On its way' },
    DELIVERED: { status: 'delivered', label: 'Delivered' },
    CANCELLED: { status: 'cancelled', label: 'Cancelled' },
};

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
            {loading && <TrackSkeleton />}

            {error === 'not_found' && (
                <Problem
                    icon={<SearchX />}
                    title="We can't find this order"
                    body="This tracking link may be broken or too old. Open the link in your WhatsApp message again, or ask the business for a new one."
                />
            )}
            {error === 'error' && (
                <Problem
                    icon={<CloudOff />}
                    title="Oops, that didn't work"
                    body="We couldn't load your order just now. Check your internet connection, then refresh this page."
                />
            )}

            {data && <OrderView data={data} />}
        </PublicPage>
    );
}

function OrderView({ data }: { data: TrackData }) {
    const step = currentStep(data);
    const pay = PAYMENT_PILL[data.paymentStatus];
    return (
        <>
            <BusinessHero name={data.businessName} />
            <PublicCard>
                <p className="text-small text-muted">Your order</p>
                <h1 className={cn(publicTitle, 'mt-1 break-words')}>{data.orderRef}</h1>
                <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill status={ORDER_PILL[data.status].status} label={ORDER_PILL[data.status].label} />
                    <StatusPill status={pay.status} label={pay.label} />
                </div>

                {data.status === 'CANCELLED' ? (
                    <p role="status" className="mt-5 rounded-control bg-error-soft px-4 py-3 text-body text-error-fg">
                        This order has been cancelled. Questions? Message the business on WhatsApp.
                    </p>
                ) : (
                    <Steps step={step} />
                )}

                <section aria-labelledby="items-h" className="mt-2 rounded-card border border-border bg-surface-2 p-4">
                    <h2 id="items-h" className="text-small text-muted">Items</h2>
                    <ul className="mt-3 space-y-2">
                        {data.items.map((it, idx) => (
                            <li key={idx} className="flex justify-between gap-4 text-body text-text">
                                <span className="min-w-0 break-words">
                                    <span className="tabular-nums text-muted">{it.quantity}×</span> {it.name}
                                </span>
                                <span className="shrink-0 tabular-nums">{formatCedi(it.quantity * it.unitPrice)}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-border pt-3">
                        <span className="text-body font-semibold text-text">Total</span>
                        <span className="font-display text-[28px] font-semibold leading-none tabular-nums text-text">
                            {formatCedi(data.totalAmount)}
                        </span>
                    </div>
                </section>

                <p className="mt-5 text-small text-muted">Last updated {formatWhen(data.updatedAt)}</p>
            </PublicCard>
        </>
    );
}

function Steps({ step }: { step: number }) {
    return (
        <ol className="mt-6" aria-label="Order progress">
            {STEPS.map((label, i) => {
                const reached = i <= step;
                const isLast = i === STEPS.length - 1;
                return (
                    <li key={label} className="flex gap-3" aria-current={i === step ? 'step' : undefined}>
                        <div className="flex flex-col items-center">
                            <span
                                className={cn(
                                    'flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold tabular-nums',
                                    reached ? 'bg-primary text-primary-fg' : 'border border-border bg-surface text-muted',
                                )}
                            >
                                {reached ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : i + 1}
                            </span>
                            {!isLast && (
                                <span className={cn('min-h-[24px] w-0.5 flex-1', i < step ? 'bg-primary' : 'bg-border')} />
                            )}
                        </div>
                        <span className={cn('pb-6 pt-0.5 text-body', reached ? 'font-semibold text-text' : 'text-muted')}>
                            {label}
                            <span className="sr-only">{reached ? ' (done)' : ' (not yet)'}</span>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

function TrackSkeleton() {
    return (
        <div aria-busy="true">
            <h1 className="sr-only">Loading your order…</h1>
            <div className="mb-5 flex items-center gap-3" aria-hidden>
                <Skeleton className="h-12 w-12 rounded-control" />
                <SkeletonLine width="w-1/2" className="h-6" />
            </div>
            <div className="rounded-card-lg border border-border bg-surface p-5 shadow-card sm:p-8" aria-hidden>
                <SkeletonLine width="w-1/4" className="h-3" />
                <SkeletonLine width="w-1/2" className="mt-3 h-7" />
                <div className="mt-6 space-y-5">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="h-7 w-7 rounded-full" />
                            <SkeletonLine width="w-1/3" />
                        </div>
                    ))}
                </div>
                <Skeleton className="mt-6 h-28 w-full rounded-card" />
            </div>
        </div>
    );
}

function Problem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
    return (
        <PublicCard>
            <div className="flex flex-col items-center text-center">
                <div aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted [&_svg]:h-8 [&_svg]:w-8">
                    {icon}
                </div>
                <h1 className={cn(publicTitle, 'mt-5')}>{title}</h1>
                <p className={cn(publicBody, 'mt-2')}>{body}</p>
            </div>
        </PublicCard>
    );
}
