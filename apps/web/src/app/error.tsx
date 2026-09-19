'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { SupportLinks } from '@/components/support-links';

/**
 * Anything below the root layout that throws lands here. The person sees
 * a way to retry, a way back, and a way to reach us; the reference id is
 * what they quote to support and what Sentry indexes.
 */
export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        Sentry.captureException(error);
        // eslint-disable-next-line no-console
        console.error(error);
    }, [error]);

    const detail = process.env.NODE_ENV === 'production' ? null : error.message;

    return (
        <main id="main" className="min-h-screen bg-ink-950 text-ink-50 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300">
                    <AlertTriangle className="h-6 w-6" aria-hidden />
                </div>
                <h1 className="mt-5 font-display text-display-md text-ink-50">Something went wrong</h1>
                <p className="mt-3 text-body text-ink-300 max-w-[42ch]">
                    This is on our side, not yours. Your bookings and chats are safe. Try again; if it keeps
                    happening, send us the reference below.
                </p>
                {detail && <p className="mt-3 text-body-sm text-rose-300 break-words">{detail}</p>}
                {error.digest && (
                    <p className="mt-3 font-mono text-[13px] text-ink-400">Reference: {error.digest}</p>
                )}
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                    <button
                        type="button"
                        onClick={() => reset()}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-bookly-emerald-500 px-6 text-[15px] font-medium text-on-accent hover:bg-bookly-emerald-400 transition-colors"
                    >
                        <RotateCw className="h-4 w-4" aria-hidden />
                        Try again
                    </button>
                    <Link
                        href="/dashboard"
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-700 px-6 text-[15px] font-medium text-ink-50 hover:border-ink-600 hover:bg-ink-900/60 transition-colors"
                    >
                        Back to dashboard
                    </Link>
                </div>
                <div className="mt-10">
                    <SupportLinks topic={`something went wrong${error.digest ? ` (ref ${error.digest})` : ''}`} />
                </div>
            </div>
        </main>
    );
}
