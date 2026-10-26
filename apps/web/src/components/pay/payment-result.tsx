'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Clock, RotateCcw, SearchX, CloudOff, XCircle } from 'lucide-react';
import { Button, Skeleton, SkeletonLine, StatusPill, TickPop, buttonVariants, cn } from '@bookingflow/ui';
import {
    BusinessHero,
    FactList,
    PublicCard,
    PublicPage,
    formatMoney,
    formatWhen,
    publicBody,
    publicTitle,
} from './public-shell';

type Kind = 'order' | 'booking';
type ViewState = 'verifying' | 'paid' | 'pending' | 'failed' | 'not_found' | 'error';

interface VerifyResponse {
    status?: 'PAID' | 'PENDING' | 'FAILED';
    kind?: Kind;
    ref?: string;
    amount?: number | null;
    currency?: string;
    businessName?: string;
    trackToken?: string | null;
    startTime?: string;
    error?: string;
}

/**
 * Customer-facing payment-confirmation screen. Paystack redirects the customer
 * here after they pay; we verify the transaction with the public verify
 * endpoint (the webhook is the primary path, this is the verify-on-return
 * backstop). Public page — no auth, no dashboard shell.
 */
export function PaymentResult({ kind }: { kind: Kind }) {
    const searchParams = useSearchParams();
    // Paystack appends both `reference` and `trxref` (same value).
    const reference = searchParams.get('reference') ?? searchParams.get('trxref');

    const [state, setState] = useState<ViewState>('verifying');
    const [data, setData] = useState<VerifyResponse | null>(null);

    const verify = useCallback(async () => {
        if (!reference) {
            setState('not_found');
            return;
        }
        setState('verifying');
        try {
            const res = await fetch(
                `/api/public/payments/verify?reference=${encodeURIComponent(reference)}`,
            );
            if (res.status === 404) {
                setState('not_found');
                return;
            }
            if (!res.ok) {
                setState('error');
                return;
            }
            const body: VerifyResponse = await res.json();
            setData(body);
            if (body.status === 'PAID') setState('paid');
            else if (body.status === 'PENDING') setState('pending');
            else setState('failed');
        } catch {
            setState('error');
        }
    }, [reference]);

    useEffect(() => {
        verify();
    }, [verify]);

    const noun = kind === 'order' ? 'order' : 'booking';

    return (
        <PublicPage>
            <BusinessHero name={data?.businessName} />
            <PublicCard>
                {state === 'verifying' && <Verifying />}

                {state === 'paid' && (
                    <div className="flex flex-col items-center text-center">
                        <TickPop size={64} label="Payment confirmed" />
                        <StatusPill status="paid" className="mt-5" />
                        <h1 className={cn(publicTitle, 'mt-3')}>Payment confirmed</h1>
                        <p className={cn(publicBody, 'mt-2')}>
                            Thank you! Your {noun} is confirmed.
                        </p>

                        {typeof data?.amount === 'number' && (
                            <p className="mt-6 font-display text-[40px] font-semibold leading-none tabular-nums text-text">
                                {formatMoney(data.amount, data.currency)}
                            </p>
                        )}

                        <PaidFacts kind={kind} data={data} />

                        {kind === 'order' && data?.trackToken && (
                            <Link
                                href={`/track/${data.trackToken}`}
                                className={cn(buttonVariants({ size: 'lg', fullWidth: true }), 'mt-6')}
                            >
                                Track your order
                                <ArrowRight className="h-4 w-4" aria-hidden />
                            </Link>
                        )}

                        <p className="mt-6 text-small text-muted">
                            You can close this page. We&apos;ve sent a confirmation to you on WhatsApp.
                        </p>
                    </div>
                )}

                {state === 'pending' && (
                    <StateBlock
                        icon={<Clock />}
                        tone="warning"
                        pill={<StatusPill status="pending" />}
                        title="Still processing"
                        body="Your payment hasn't been confirmed yet. This can take a minute, so check again shortly."
                        action={<RetryButton onClick={verify} label="Check again" />}
                    />
                )}

                {state === 'failed' && (
                    <StateBlock
                        icon={<XCircle />}
                        tone="error"
                        pill={<StatusPill status="failed" />}
                        title="Payment not completed"
                        body="We couldn't confirm this payment. If money left your account, message the business on WhatsApp and they'll sort it out."
                        action={<RetryButton onClick={verify} label="Try again" />}
                    />
                )}

                {state === 'not_found' && (
                    <StateBlock
                        icon={<SearchX />}
                        tone="neutral"
                        title="We can't find this payment"
                        body="This link may be broken or too old. Open the link in your WhatsApp message again, or ask the business to send a new one."
                    />
                )}

                {state === 'error' && (
                    <StateBlock
                        icon={<CloudOff />}
                        tone="error"
                        title="Oops, that didn't work"
                        body="We couldn't check your payment just now. Check your internet connection, then try again."
                        action={<RetryButton onClick={verify} label="Try again" />}
                    />
                )}
            </PublicCard>
        </PublicPage>
    );
}

function PaidFacts({ kind, data }: { kind: Kind; data: VerifyResponse | null }) {
    const rows: Array<[string, React.ReactNode]> = [];
    if (data?.ref) rows.push(['Reference', <span className="font-mono text-[15px]">{data.ref}</span>]);
    if (kind === 'booking' && data?.startTime) rows.push(['Appointment', formatWhen(data.startTime)]);
    if (rows.length === 0) return null;
    return <FactList className="mt-6 w-full text-left" rows={rows} />;
}

function Verifying() {
    return (
        <div className="flex flex-col items-center text-center" aria-busy="true">
            <Skeleton className="h-16 w-16 rounded-full" />
            <h1 className={cn(publicTitle, 'mt-5')}>Confirming your payment…</h1>
            <p className={cn(publicBody, 'mt-2')}>This only takes a moment.</p>
            <div className="mt-6 w-full space-y-3" aria-hidden>
                <Skeleton className="mx-auto h-10 w-40" />
                <SkeletonLine />
                <SkeletonLine width="w-4/5" />
            </div>
        </div>
    );
}

const ICON_TONES = {
    warning: 'bg-warning-soft text-warning-fg',
    error: 'bg-error-soft text-error-fg',
    neutral: 'bg-surface-2 text-muted',
} as const;

function StateBlock({
    icon,
    tone,
    pill,
    title,
    body,
    action,
}: {
    icon: React.ReactNode;
    tone: keyof typeof ICON_TONES;
    pill?: React.ReactNode;
    title: string;
    body: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center text-center">
            <div
                aria-hidden
                className={cn('flex h-16 w-16 items-center justify-center rounded-full [&_svg]:h-8 [&_svg]:w-8', ICON_TONES[tone])}
            >
                {icon}
            </div>
            {pill && <div className="mt-5">{pill}</div>}
            <h1 className={cn(publicTitle, pill ? 'mt-3' : 'mt-5')}>{title}</h1>
            <p className={cn(publicBody, 'mt-2')}>{body}</p>
            {action && <div className="mt-6 w-full">{action}</div>}
        </div>
    );
}

function RetryButton({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <Button size="lg" fullWidth onClick={onClick}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {label}
        </Button>
    );
}
