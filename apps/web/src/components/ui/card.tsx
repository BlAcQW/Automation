'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    hover?: boolean;
    glass?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
    ({ className, hover = false, glass = false, children, ...props }, ref) => {
        const Comp = hover ? motion.div : 'div';
        const motionProps = hover
            ? { whileHover: { y: -2, transition: { duration: 0.2 } } }
            : {};

        return (
            <Comp
                ref={ref}
                className={cn(
                    'rounded-2xl border transition-all duration-300',
                    glass
                        ? 'bg-ink-900/50 backdrop-blur-xl border-ink-700/60 shadow-card-lg'
                        : 'bg-ink-900 border-ink-700/70 shadow-card',
                    hover && 'hover:shadow-card-hover hover:border-bookly-emerald-500/40',
                    className
                )}
                {...motionProps}
                {...(props as any)}
            >
                {children}
            </Comp>
        );
    }
);

Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn('px-6 py-4 border-b border-ink-700/70', className)}
            {...props}
        />
    )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3
            ref={ref}
            className={cn('font-display font-semibold text-ink-50 flex items-center gap-2', className)}
            {...props}
        />
    )
);
CardTitle.displayName = 'CardTitle';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('p-6', className)} {...props} />
    )
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
