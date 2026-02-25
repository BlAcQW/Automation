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
                    'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:brightness-110 focus-visible:ring-emerald-500',
                secondary:
                    'bg-white/10 text-white border border-white/10 hover:bg-white/20 hover:border-white/20 backdrop-blur-sm',
                outline:
                    'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700',
                ghost:
                    'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white',
                destructive:
                    'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 hover:bg-red-500/20',
                glow:
                    'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_50px_rgba(16,185,129,0.6)] hover:brightness-110',
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
