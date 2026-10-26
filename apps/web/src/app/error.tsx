'use client';

import { useEffect } from 'react';
import { RotateCw, AlertTriangle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { SupportLinks } from '@/components/support-links';
import { ButtonLink } from '@/components/marketing/primitives';
import { StatusPage } from '@/components/marketing/status-page';

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
        <StatusPage>
            <p className="inline-flex items-center gap-2 rounded-full bg-error-soft px-3 py-1 text-small font-semibold text-error-fg">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Something went wrong
            </p>
            <h1 className="mt-4 font-display text-page-title text-text">Oops, that didn&apos;t work.</h1>
            <p className="mt-3 text-body text-muted">
                This is on our side, not yours. Your bookings and chats are safe. Let&apos;s try again; if it keeps
                happening, send us the reference below.
            </p>
            {detail && <p className="mt-3 break-words text-small text-error-fg">{detail}</p>}
            {error.digest && (
                <p className="mt-4 inline-flex rounded-control bg-surface-2 px-3 py-2 font-mono text-small tabular-nums text-text">
                    Reference: {error.digest}
                </p>
            )}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {/* Plain button, not @bookingflow/ui Button: this boundary loads on
                    every page, and Button would pull framer-motion into all of them. */}
                <button
                    type="button"
                    onClick={() => reset()}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 text-base font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover active:scale-[0.97] motion-reduce:active:scale-100"
                >
                    <RotateCw className="h-4 w-4" aria-hidden />
                    Try again
                </button>
                <ButtonLink href="/dashboard" variant="secondary">Back to my dashboard</ButtonLink>
            </div>
            <div className="mt-8 border-t border-border pt-6">
                <SupportLinks topic={`something went wrong${error.digest ? ` (ref ${error.digest})` : ''}`} />
            </div>
        </StatusPage>
    );
}
