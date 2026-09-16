'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default:
                    'bg-bookly-emerald-500 text-on-accent shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)] hover:bg-bookly-emerald-400 focus-visible:ring-bookly-emerald-500',
                secondary:
                    'bg-ink-800 text-ink-100 hover:bg-ink-700 focus-visible:ring-ink-500',
                outline:
                    'border border-ink-700 bg-ink-900 text-ink-50 hover:bg-ink-800 hover:border-ink-600',
                ghost:
                    'text-ink-200 hover:bg-ink-800/60 hover:text-ink-50',
                destructive:
                    'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20',
                // Kept as an alias of `default` so existing call sites compile;
                // the neon halo it used to draw is retired.
                glow:
                    'bg-bookly-emerald-500 text-on-accent shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)] hover:bg-bookly-emerald-400 focus-visible:ring-bookly-emerald-500',
            },
            size: {
                sm: 'h-9 px-3 text-sm rounded-lg',
                md: 'h-11 px-5 text-sm',
                lg: 'h-12 px-8 text-base',
                xl: 'h-14 px-10 text-lg',
                icon: 'h-10 w-10 rounded-lg',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'md',
        },
    }
);

export interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, isLoading, children, disabled, ...props }, ref) => {
        return (
            <motion.button
                ref={ref}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={cn(buttonVariants({ variant, size, className }))}
                disabled={disabled || isLoading}
                {...(props as any)}
            >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
            </motion.button>
        );
    }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
