'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, AlertCircle, Clock, ArrowRight } from 'lucide-react';

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
        <main className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <Card>
                    {state === 'verifying' && (
                        <Centered>
                            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                            <h1 className="text-lg font-semibold text-slate-900 mt-4">
                                Confirming your payment…
                            </h1>
                            <p className="text-sm text-slate-500 mt-1">This only takes a moment.</p>
                        </Centered>
                    )}

                    {state === 'paid' && (
                        <Centered>
                            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                                <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                            </div>
                            <h1 className="text-xl font-semibold text-slate-900 mt-4">
                                Payment confirmed
                            </h1>
                            {data?.businessName && (
                                <p className="text-xs uppercase tracking-wide text-slate-400 mt-1">
                                    {data.businessName}
                                </p>
                            )}
                            <p className="text-sm text-slate-500 mt-2">
                                Your {noun}{' '}
                                {data?.ref && <span className="font-mono text-slate-700">{data.ref}</span>}{' '}
                                is confirmed.
                            </p>

                            {typeof data?.amount === 'number' && (
                                <p className="text-2xl font-bold text-slate-900 mt-3">
                                    {data.currency} {data.amount.toFixed(2)}
                                </p>
                            )}

                            {kind === 'booking' && data?.startTime && (
                                <p className="text-sm text-slate-600 mt-2">
                                    {new Date(data.startTime).toLocaleString()}
                                </p>
                            )}

                            {kind === 'order' && data?.trackToken && (
                                <Link
                                    href={`/track/${data.trackToken}`}
                                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
                                >
                                    Track your order
                                    <ArrowRight className="w-4 h-4" />
                                </Link>
                            )}

                            <p className="text-xs text-slate-400 mt-6">
                                You can close this page — a confirmation has been sent to you on WhatsApp.
                            </p>
                        </Centered>
                    )}

                    {state === 'pending' && (
                        <Centered>
                            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                                <Clock className="w-9 h-9 text-amber-600" />
                            </div>
                            <h1 className="text-xl font-semibold text-slate-900 mt-4">
                                Still processing
                            </h1>
                            <p className="text-sm text-slate-500 mt-2">
                                Your payment hasn&apos;t been confirmed yet. This can take a minute —
                                check again shortly.
                            </p>
                            <button
                                onClick={verify}
                                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
                            >
                                Check again
                            </button>
                        </Centered>
                    )}

                    {state === 'failed' && (
                        <Centered>
                            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                                <AlertCircle className="w-9 h-9 text-red-600" />
                            </div>
                            <h1 className="text-xl font-semibold text-slate-900 mt-4">
                                Payment not completed
                            </h1>
                            <p className="text-sm text-slate-500 mt-2">
                                We couldn&apos;t confirm this payment. If you were charged, message the
                                business on WhatsApp and they&apos;ll help sort it out.
                            </p>
                            <button
                                onClick={verify}
                                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
                            >
                                Try again
                            </button>
                        </Centered>
                    )}

                    {state === 'not_found' && (
                        <Centered>
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                                <AlertCircle className="w-9 h-9 text-slate-400" />
                            </div>
                            <h1 className="text-lg font-semibold text-slate-900 mt-4">
                                Payment not found
                            </h1>
                            <p className="text-sm text-slate-500 mt-2">
                                This link is invalid or has expired. Check the link in your message
                                and try again.
                            </p>
                        </Centered>
                    )}

                    {state === 'error' && (
                        <Centered>
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                                <AlertCircle className="w-9 h-9 text-slate-400" />
                            </div>
                            <h1 className="text-lg font-semibold text-slate-900 mt-4">
                                Something went wrong
                            </h1>
                            <p className="text-sm text-slate-500 mt-2">
                                We couldn&apos;t reach the server. Please try again in a moment.
                            </p>
                            <button
                                onClick={verify}
                                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
                            >
                                Try again
                            </button>
                        </Centered>
                    )}
                </Card>
            </div>
        </main>
    );
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">{children}</div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-col items-center text-center">{children}</div>;
}
