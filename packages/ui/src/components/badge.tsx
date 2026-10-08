'use client';

import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

const badgeVariants = cva(
    'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] leading-[18px] font-medium tracking-normal normal-case transition-colors',
    {
        variants: {
            variant: {
                // Muted, ink-toned fills: status reads from the hue, not from loudness.
                default: 'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-200',
                blue: 'bg-[#DDE4EA] text-[#2C4A63] dark:bg-[#2C4A63]/40 dark:text-[#B9CCDD]',
                yellow: 'bg-[#F1E3C2] text-[#7A5512] dark:bg-[#FFD98A]/15 dark:text-[#FFD98A]',
                red: 'bg-[#F0D9D5] text-[#962F25] dark:bg-[#B03A2E]/25 dark:text-[#F0B8B0]',
                purple: 'bg-[#E4DEEA] text-[#53426B] dark:bg-[#53426B]/40 dark:text-[#CFC3DE]',
                orange: 'bg-[#F0DDCB] text-[#87471C] dark:bg-[#87471C]/35 dark:text-[#EBC29F]',
                slate: 'bg-ink-800 text-ink-200 dark:bg-ink-800 dark:text-ink-200',
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
                <span className="relative flex h-2 w-2">
                    {pulse && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                    )}
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
                </span>
            )}
            {children}
        </span>
    );
}

export { Badge, badgeVariants };
