'use client';

import { CloudOff, Loader2 } from 'lucide-react';

interface QueryStateProps {
    isLoading: boolean;
    isError: boolean;
    /** True when the request succeeded but returned nothing. */
    isEmpty?: boolean;
    onRetry?: () => void;
    /** Shown only when isEmpty — never when the request failed. */
    empty?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * The three outcomes of a query, told apart.
 *
 * Worse here than on mobile: pages default with `data: conversations = []`,
 * which swallows the error completely — a failed request rendered exactly like
 * an empty account. A business with 200 conversations saw "No conversations
 * yet" whenever the API blipped.
 *
 * Failure and emptiness are different facts and must never share a screen.
 */
export function QueryState({ isLoading, isError, isEmpty, onRetry, empty, children }: QueryStateProps) {
    if (isLoading) {
        return (
            <div className="flex flex-1 items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                <CloudOff className="h-9 w-9 text-ink-400" strokeWidth={1.5} />
                <p className="mt-1 text-[17px] font-medium tracking-[-0.03em] text-ink-50">Can&apos;t reach the server</p>
                <p className="max-w-[44ch] text-sm text-ink-300">
                    Your data is safe. Check your connection and try again.
                </p>
                {onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="mt-3 inline-flex min-h-[44px] items-center rounded bg-forest-brand px-5 text-sm font-medium text-on-accent
                                   shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18)]
                                   hover:bg-bookly-emerald-700 transition-colors focus-visible:outline focus-visible:outline-2
                                   focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]"
                    >
                        Try again
                    </button>
                ) : null}
            </div>
        );
    }

    if (isEmpty && empty) return <>{empty}</>;

    return <>{children}</>;
}
