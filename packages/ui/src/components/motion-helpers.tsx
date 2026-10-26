'use client';

import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { durations, ease, revealVariants, staggerVariants } from '../motion';

export { useReducedMotion };

interface PageTransitionProps {
    children: ReactNode;
    className?: string;
}

/**
 * App-page entrance: fade + 8px rise, 300ms ease-out. For signed-in app
 * pages (client-rendered after auth). Do NOT wrap marketing / public SSR
 * pages — they must be visible before JS; use the CSS `.site-enter` class.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
    const reduce = useReducedMotion();
    return (
        <motion.div
            className={className}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: durations.medium, ease: ease.out }}
        >
            {children}
        </motion.div>
    );
}

interface StaggerProps {
    children: ReactNode;
    className?: string;
    /** Render as a list. */
    as?: 'div' | 'ul' | 'ol';
}

/** Parent for list/card entrances: children (StaggerItem) arrive 60ms apart. */
export function Stagger({ children, className, as = 'div' }: StaggerProps) {
    const reduce = useReducedMotion();
    const Comp = motion[as];
    return (
        <Comp className={className} variants={staggerVariants} initial={reduce ? false : 'hidden'} animate="visible">
            {children}
        </Comp>
    );
}

interface StaggerItemProps {
    children: ReactNode;
    className?: string;
    as?: 'div' | 'li';
}

export function StaggerItem({ children, className, as = 'div' }: StaggerItemProps) {
    const Comp = motion[as];
    return (
        <Comp className={className} variants={revealVariants}>
            {children}
        </Comp>
    );
}
