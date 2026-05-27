import { cn } from '@/lib/cn';

interface BooklyWordmarkProps {
    className?: string;
    /** When true, render at hero scale (display-xl) instead of nav scale. */
    size?: 'nav' | 'lg' | 'xl';
}

/**
 * Bookly wordmark — Cabinet Grotesk 700 with a small emerald dot after
 * the "y" (ui.md §7.1). Text-only; no SVG asset required.
 */
export function BooklyWordmark({ className, size = 'nav' }: BooklyWordmarkProps) {
    const text = size === 'xl'
        ? 'text-display-xl'
        : size === 'lg'
            ? 'text-display-md'
            : 'text-h2';
    const dotSize = size === 'xl' ? 'h-3 w-3' : size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5';
    return (
        <span className={cn('relative inline-flex items-end gap-0.5 font-display font-bold tracking-tight text-ink-50', text, className)}>
            Bookly
            <span
                className={cn(
                    'rounded-full bg-bookly-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)] mb-1.5 animate-pulse-soft',
                    dotSize,
                )}
                aria-hidden
            />
        </span>
    );
}
