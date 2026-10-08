'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '../cn';

const buttonVariants = cva(
    // Forest ledger: small 3px corners, medium weight, tight tracking. The
    // focus ring is the theme ring (forest on paper, gold on night).
    'inline-flex items-center justify-center gap-2 rounded font-medium tracking-[-0.01em] whitespace-nowrap transition-[background-color,box-shadow,color,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default:
                    'bg-accent-600 text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18)] hover:bg-accent-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_8px_22px_-8px_rgb(var(--accent-600-rgb)/0.7)] dark:bg-accent-500 dark:hover:bg-accent-600',
                secondary:
                    'bg-ink-1000 text-ink-50 shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.1),0_1px_2px_rgba(0,0,0,0.06)] hover:shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.18),0_8px_22px_-12px_rgba(0,0,0,0.35)] dark:bg-ink-800 dark:hover:bg-ink-700',
                outline:
                    'bg-transparent text-ink-50 shadow-[inset_0_0_0_1px_rgb(var(--ink-50-rgb)/0.22)] hover:bg-ink-50/[0.04] hover:shadow-[inset_0_0_0_1px_rgb(var(--ink-50-rgb)/0.45)]',
                ghost:
                    'text-ink-200 hover:bg-ink-50/[0.06] hover:text-ink-50',
                destructive:
                    'bg-[#B03A2E] text-[#FBFAF7] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18)] hover:bg-[#962F25]',
                // Kept as an alias of `default` so existing call sites compile.
                glow:
                    'bg-accent-600 text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18)] hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600',
            },
            size: {
                sm: 'h-9 px-3.5 text-[13px]',
                md: 'h-11 px-5 text-sm',
                lg: 'h-12 px-6 text-[15px]',
                xl: 'h-14 px-8 text-base',
                icon: 'h-10 w-10',
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
                whileTap={{ y: 1 }}
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
