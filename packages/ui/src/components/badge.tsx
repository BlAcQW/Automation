'use client';

import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

/**
 * Small label chip. For anything that is a STATUS (paid, pending, failed…)
 * use <StatusPill> instead — it always pairs the colour with an icon + word.
 *
 * Semantic variants: neutral, success, warning, error, info.
 * Legacy variants (default, blue, yellow, red, purple, orange, slate) still
 * work and map onto the brand palette.
 */
const badgeVariants = cva(
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium normal-case transition-colors',
    {
        variants: {
            variant: {
                neutral: 'bg-surface-2 text-text',
                success: 'bg-success-soft text-success-fg',
                warning: 'bg-warning-soft text-warning-fg',
                error: 'bg-error-soft text-error-fg',
                info: 'bg-[#E6EEF6] text-[#24507A] dark:bg-[#24507A]/40 dark:text-[#B9CCDD]',
                // Legacy names → brand.
                default: 'bg-primary-soft text-primary-hover dark:text-success-fg',
                blue: 'bg-[#E6EEF6] text-[#24507A] dark:bg-[#24507A]/40 dark:text-[#B9CCDD]',
                yellow: 'bg-warning-soft text-warning-fg',
                red: 'bg-error-soft text-error-fg',
                purple: 'bg-[#EEE8F4] text-[#55407A] dark:bg-[#55407A]/40 dark:text-[#D3C6E6]',
                orange: 'bg-warning-soft text-warning-fg',
                slate: 'bg-surface-2 text-muted',
            },
            pulse: {
                true: '',
                false: '',
            },
        },
        defaultVariants: {
            variant: 'default',
            pulse: false,
        },
    }
);

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
    dot?: boolean;
}

function Badge({ className, variant, pulse, dot, children, ...props }: BadgeProps) {
    return (
        <span className={cn(badgeVariants({ variant, pulse }), className)} {...props}>
            {dot && (
                <span className="relative flex h-2 w-2" aria-hidden>
                    {pulse && (
                        <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                    )}
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
                </span>
            )}
            {children}
        </span>
    );
}

export { Badge, badgeVariants };
