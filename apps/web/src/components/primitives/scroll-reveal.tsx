'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { revealVariants, staggerVariants } from '@/lib/motion';
import type { ReactNode } from 'react';

interface ScrollRevealProps {
    children: ReactNode;
    /** When true, children inside this container will stagger by 80ms each. */
    stagger?: boolean;
    /** Allow override of the trigger threshold (0–1). 0.3 by default. */
    amount?: number;
    className?: string;
    /** Optional id for in-page anchors. */
    id?: string;
}

/**
 * Section-level reveal wrapper — ui.md §10.2. Fades + translates children
 * up 24px when 30% of the section is in view; staggers children by 80ms
 * when `stagger` is set. Respects `prefers-reduced-motion` automatically.
 */
export function ScrollReveal({
    children,
    stagger = false,
    amount = 0.3,
    className,
    id,
}: ScrollRevealProps) {
    const reduce = useReducedMotion();

    if (reduce) {
        return (
            <section id={id} className={className}>
                {children}
            </section>
        );
    }

    return (
        <motion.section
            id={id}
            className={className}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount }}
            variants={stagger ? staggerVariants : revealVariants}
        >
            {children}
        </motion.section>
    );
}

/**
 * Use for individual children inside a `<ScrollReveal stagger>` parent.
 * Inherits the parent's stagger schedule.
 */
export function ScrollRevealItem({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <motion.div variants={revealVariants} className={className}>
            {children}
        </motion.div>
    );
}
