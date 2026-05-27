'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface BooklyDotsProps {
    /** Visual scale. xs ~ 4px dots (inline), lg ~ 10px dots (full-page). */
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** 'emerald' (default) on dark surfaces · 'ink' for use against emerald CTAs. */
    tone?: 'emerald' | 'ink';
    /** When true, wraps the dots in a flex container that fills its parent and centers. */
    centered?: boolean;
    /** Screen-reader label. Defaults to "Loading". */
    label?: string;
    className?: string;
}

const SIZE_TOKENS: Record<NonNullable<BooklyDotsProps['size']>, { dot: string; gap: string }> = {
    xs: { dot: 'h-1 w-1', gap: 'gap-1' },
    sm: { dot: 'h-1.5 w-1.5', gap: 'gap-1.5' },
    md: { dot: 'h-2 w-2', gap: 'gap-2' },
    lg: { dot: 'h-2.5 w-2.5', gap: 'gap-2.5' },
};

/**
 * Signature Bookly loader — three emerald dots, staggered pulse. The same
 * gesture as the hero's TypingIndicator: "someone is on the other end."
 * Reduced-motion safe (freezes at 0.7 opacity).
 */
export function BooklyDots({
    size = 'md',
    tone = 'emerald',
    centered = false,
    label = 'Loading',
    className,
}: BooklyDotsProps) {
    const reduce = useReducedMotion();
    const { dot, gap } = SIZE_TOKENS[size];
    const color = tone === 'ink' ? 'bg-ink-50' : 'bg-bookly-emerald-400';

    const dots = (
        <span
            role="status"
            aria-live="polite"
            className={cn('inline-flex items-center', gap, className)}
        >
            {[0, 1, 2].map((n) => (
                <motion.span
                    key={n}
                    aria-hidden
                    className={cn('rounded-full', dot, color)}
                    initial={{ opacity: 0.3 }}
                    animate={reduce ? { opacity: 0.7 } : { opacity: [0.3, 1, 0.3] }}
                    transition={
                        reduce
                            ? { duration: 0 }
                            : {
                                duration: 1.2,
                                repeat: Infinity,
                                ease: 'easeInOut',
                                delay: n * 0.2,
                            }
                    }
                />
            ))}
            <span className="sr-only">{label}</span>
        </span>
    );

    if (!centered) return dots;

    return (
        <div className="flex h-full min-h-[8rem] w-full items-center justify-center">
            {dots}
        </div>
    );
}
