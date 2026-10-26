'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '../cn';
import { pressScale } from '../motion';

/**
 * Bookly button. 12px corners, min 44px tall (tap target), Bricolage 600,
 * press scale 0.97, gold focus outline (global :focus-visible).
 *
 * Variants: primary (green — the default), accent (gold — once per screen,
 * for THE most important action), secondary (outline), ghost, destructive.
 * `default`, `outline` and `glow` are kept as aliases so existing call sites compile.
 */
const buttonVariants = cva(
    'relative inline-flex items-center justify-center gap-2 rounded-control font-sans font-semibold whitespace-nowrap select-none transition-[background-color,box-shadow,color,border-color] duration-ui ease-brand-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
    {
        variants: {
            variant: {
                primary: 'bg-primary text-primary-fg shadow-soft hover:bg-primary-hover',
                accent: 'bg-accent text-accent-fg shadow-soft hover:bg-accent-hover',
                secondary: 'bg-surface text-text border border-border hover:border-text/30 hover:bg-surface-2',
                ghost: 'text-text hover:bg-text/[0.06]',
                destructive: 'bg-error text-white shadow-soft hover:bg-error-fg',
                // Aliases (legacy names).
                default: 'bg-primary text-primary-fg shadow-soft hover:bg-primary-hover',
                outline: 'bg-transparent text-text border border-border hover:border-text/30 hover:bg-text/[0.04]',
                glow: 'bg-primary text-primary-fg shadow-soft hover:bg-primary-hover',
            },
            size: {
                sm: 'min-h-[44px] h-11 px-4 text-[14px]',
                md: 'min-h-[44px] h-11 px-5 text-[15px]',
                lg: 'min-h-[48px] h-12 px-6 text-base',
                xl: 'min-h-[56px] h-14 px-8 text-[17px]',
                icon: 'h-11 w-11 min-h-[44px] min-w-[44px]',
            },
            fullWidth: {
                true: 'w-full',
                false: '',
            },
        },
        defaultVariants: {
            variant: 'primary',
            size: 'md',
            fullWidth: false,
        },
    }
);

export interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    isLoading?: boolean;
    /** Text announced (and shown next to the spinner) while loading. */
    loadingText?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, fullWidth, isLoading, loadingText, children, disabled, ...props }, ref) => {
        const reduce = useReducedMotion();
        return (
            <motion.button
                ref={ref}
                whileTap={reduce || disabled || isLoading ? undefined : pressScale}
                transition={{ duration: 0.12 }}
                className={cn(buttonVariants({ variant, size, fullWidth, className }))}
                disabled={disabled || isLoading}
                aria-busy={isLoading || undefined}
                {...(props as any)}
            >
                {isLoading ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        {loadingText ? <span>{loadingText}</span> : <span className="sr-only">Loading</span>}
                    </>
                ) : (
                    children
                )}
            </motion.button>
        );
    }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
