import { cn } from '@bookingflow/ui';

interface BooklyWordmarkProps {
    className?: string;
    /** When true, render at hero scale (display-xl) instead of nav scale. */
    size?: 'nav' | 'lg' | 'xl';
}

/**
 * Bookly wordmark — Inter Tight 600, tight tracking, with a small flat
 * forest dot after the "y". Text-only; no SVG asset required.
 */
export function BooklyWordmark({ className, size = 'nav' }: BooklyWordmarkProps) {
    const text = size === 'xl'
        ? 'text-display-xl'
        : size === 'lg'
            ? 'text-display-md'
            : 'text-h2';
    const dotSize = size === 'xl' ? 'h-3 w-3' : size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5';
    return (
        <span className={cn('relative inline-flex items-end gap-0.5 font-sans font-semibold tracking-[-0.04em] text-ink-50', text, className)}>
            Bookly
            <span
                className={cn(
                    'rounded-full bg-bookly-emerald-500 mb-1.5',
                    dotSize,
                )}
                aria-hidden
            />
        </span>
    );
}
