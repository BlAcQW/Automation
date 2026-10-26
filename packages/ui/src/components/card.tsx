'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    /** Lift 2px with a deeper warm shadow on hover (clickable cards). */
    hover?: boolean;
    /** Legacy prop: renders the same surface with the larger shadow. */
    glass?: boolean;
}

/**
 * White surface on the cream page: 20px corners, hairline border, soft warm
 * shadow. Use `rounded-card-lg` (24px) for hero / feature cards.
 */
const Card = forwardRef<HTMLDivElement, CardProps>(
    ({ className, hover = false, glass = false, children, ...props }, ref) => {
        const reduce = useReducedMotion();
        const Comp = hover ? motion.div : 'div';
        const motionProps = hover && !reduce
            ? { whileHover: { y: -2, transition: { duration: 0.2 } } }
            : {};

        return (
            <Comp
                ref={ref}
                className={cn(
                    'rounded-card border border-border bg-surface text-text transition-[box-shadow,transform] duration-ui-slow ease-brand-out',
                    glass ? 'shadow-card-lg' : 'shadow-card',
                    hover && 'hover:shadow-card-hover',
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
            className={cn('px-5 py-4 sm:px-6 border-b border-border', className)}
            {...props}
        />
    )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3
            ref={ref}
            className={cn('font-sans text-[17px] font-bold leading-snug text-text flex items-center gap-2', className)}
            {...props}
        />
    )
);
CardTitle.displayName = 'CardTitle';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('p-5 sm:p-6', className)} {...props} />
    )
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
