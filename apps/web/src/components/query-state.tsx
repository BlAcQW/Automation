'use client';

import { ErrorState, SkeletonList } from '@bookingflow/ui';

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
            <div aria-busy="true" className="px-4 py-2">
                <span className="sr-only">Loading…</span>
                <SkeletonList rows={4} />
            </div>
        );
    }

    if (isError) {
        return (
            <ErrorState
                title="We can't reach Bookly right now"
                description="Your data is safe. Check your internet connection, then try again."
                onRetry={onRetry}
            />
        );
    }

    if (isEmpty && empty) return <>{empty}</>;

    return <>{children}</>;
}
