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
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                <CloudOff className="h-9 w-9 text-slate-400" />
                <p className="text-sm font-medium text-slate-900 dark:text-white">Can&apos;t reach the server</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Your data is safe — check your connection and try again.
                </p>
                {onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="mt-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white
                                   hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2
                                   focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
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
