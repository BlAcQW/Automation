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
        <main id="main" className="relative isolate flex min-h-screen items-center bg-ink-950 px-4 py-12 text-ink-50 sm:px-8">
            <div className="fs-hero-grid" aria-hidden />
            <div className="mx-auto w-full max-w-xl">
                <p className="flex items-center gap-2 font-mono text-[11px] text-ink-300">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-300" aria-hidden />
                    /error/
                </p>
                <h1 className="mt-4 max-w-[14ch] text-[clamp(40px,7vw,72px)] font-normal leading-[0.98] tracking-[-0.05em] text-ink-50">
                    Something went wrong
                </h1>
                <p className="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-ink-300">
                    This is on our side, not yours. Your bookings and chats are safe. Try again; if it keeps
                    happening, send us the reference below.
                </p>
                {detail && <p className="mt-3 break-words text-[13px] text-rose-700 dark:text-rose-300">{detail}</p>}
                {error.digest && (
                    <p className="mt-4 inline-flex rounded-[3px] bg-ink-900 px-2.5 py-1.5 font-mono text-[12px] tabular-nums text-ink-300 ring-1 ring-ink-700/60">
                        Reference: {error.digest}
                    </p>
                )}
                <div className="mt-9 flex flex-col gap-2 sm:flex-row">
                    <button
                        type="button"
                        onClick={() => reset()}
                        className="fs-btn fs-btn--lg fs-btn--brand"
                    >
                        <RotateCw className="h-4 w-4" aria-hidden />
                        Try again
                    </button>
                    <Link href="/dashboard" className="fs-btn fs-btn--lg fs-btn--ghost text-ink-50">
                        Back to dashboard
                    </Link>
                </div>
                <div className="mt-12 border-t border-ink-700/60 pt-5">
                    <SupportLinks topic={`something went wrong${error.digest ? ` (ref ${error.digest})` : ''}`} />
                </div>
            </div>
        </main>
    );
}
