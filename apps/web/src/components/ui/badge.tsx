'use client';

import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
    {
        variants: {
            variant: {
                default: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
                orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
                slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
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
