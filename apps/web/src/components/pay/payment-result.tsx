'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, AlertCircle, Clock, ArrowRight } from 'lucide-react';
import {
    PaperCard,
    PublicPage,
    SummaryCard,
    publicBody,
    publicBrandBtn,
    publicFine,
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
            <PaperCard className="sm:p-8">
                {state === 'verifying' && (
                    <Centered>
                        <Loader2 className="w-9 h-9 text-forest-brand animate-spin" />
                        <h1 className={`${publicTitle} mt-5`}>
                            Confirming your payment…
                        </h1>
                        <p className={`mt-2 ${publicBody}`}>This only takes a moment.</p>
                    </Centered>
                )}

                {state === 'paid' && (
                    <Centered>
                        <StatusMark tone="ok"><CheckCircle2 className="w-6 h-6" /></StatusMark>
                        <h1 className={`${publicTitle} mt-5`}>
                            Payment confirmed
                        </h1>
                        <p className={`mt-2 ${publicBody}`}>
                            Your {noun}{' '}
                            {data?.ref && <span className="font-mono text-[13px] text-forest-ink">{data.ref}</span>}{' '}
                            is confirmed.
                        </p>

                        {(data?.businessName || typeof data?.amount === 'number' || (kind === 'booking' && data?.startTime)) && (
                            <SummaryCard className="mt-6 w-full text-left">
                                {data?.businessName && (
                                    <p className="text-[12px] font-medium text-forest-cream/60">
                                        {data.businessName}
                                    </p>
                                )}
                                {typeof data?.amount === 'number' && (
                                    <p className="mt-2 text-[30px] font-light leading-none tracking-[-0.04em] tabular-nums">
                                        {data.currency} {data.amount.toFixed(2)}
                                    </p>
                                )}
                                {kind === 'booking' && data?.startTime && (
                                    <p className="mt-3 pt-3 border-t border-forest-cream/10 text-[14px] text-forest-cream/80 tabular-nums">
                                        {new Date(data.startTime).toLocaleString()}
                                    </p>
                                )}
                            </SummaryCard>
                        )}

                        {kind === 'order' && data?.trackToken && (
                            <Link
                                href={`/track/${data.trackToken}`}
                                className={`mt-6 fs-btn--wide ${publicBrandBtn}`}
                            >
                                Track your order
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        )}

                        <p className={`mt-6 ${publicFine}`}>
                            You can close this page — a confirmation has been sent to you on WhatsApp.
                        </p>
                    </Centered>
                )}

                {state === 'pending' && (
                    <Centered>
                        <StatusMark tone="wait"><Clock className="w-6 h-6" /></StatusMark>
                        <h1 className={`${publicTitle} mt-5`}>
                            Still processing
                        </h1>
                        <p className={`mt-2 ${publicBody}`}>
                            Your payment hasn&apos;t been confirmed yet. This can take a minute —
                            check again shortly.
                        </p>
                        <button onClick={verify} className={`mt-6 ${publicBrandBtn}`}>
                            Check again
                        </button>
                    </Centered>
                )}

                {state === 'failed' && (
                    <Centered>
                        <StatusMark tone="bad"><AlertCircle className="w-6 h-6" /></StatusMark>
                        <h1 className={`${publicTitle} mt-5`}>
                            Payment not completed
                        </h1>
                        <p className={`mt-2 ${publicBody}`}>
                            We couldn&apos;t confirm this payment. If you were charged, message the
                            business on WhatsApp and they&apos;ll help sort it out.
                        </p>
                        <button onClick={verify} className={`mt-6 ${publicBrandBtn}`}>
                            Try again
                        </button>
                    </Centered>
                )}

                {state === 'not_found' && (
                    <Centered>
                        <StatusMark tone="muted"><AlertCircle className="w-6 h-6" /></StatusMark>
                        <h1 className={`${publicTitle} mt-5`}>
                            Payment not found
                        </h1>
                        <p className={`mt-2 ${publicBody}`}>
                            This link is invalid or has expired. Check the link in your message
                            and try again.
                        </p>
                    </Centered>
                )}

                {state === 'error' && (
                    <Centered>
                        <StatusMark tone="muted"><AlertCircle className="w-6 h-6" /></StatusMark>
                        <h1 className={`${publicTitle} mt-5`}>
                            Something went wrong
                        </h1>
                        <p className={`mt-2 ${publicBody}`}>
                            We couldn&apos;t reach the server. Please try again in a moment.
                        </p>
                        <button onClick={verify} className={`mt-6 ${publicBrandBtn}`}>
                            Try again
                        </button>
                    </Centered>
                )}
            </PaperCard>
        </PublicPage>
    );
}

const MARK_TONES = {
    ok: 'bg-forest-night text-forest-glow',
    wait: 'bg-[#E0A43A]/15 text-[#8A5A12]',
    bad: 'bg-[#B03A2E]/10 text-[#B03A2E]',
    muted: 'bg-forest-ink/[.06] text-[#7F857B]',
} as const;

function StatusMark({ tone, children }: { tone: keyof typeof MARK_TONES; children: React.ReactNode }) {
    return (
        <div className={`w-14 h-14 rounded-[6px] flex items-center justify-center ${MARK_TONES[tone]}`} aria-hidden>
            {children}
        </div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-col items-center text-center">{children}</div>;
}
