/**
 * Shared motion tokens — ui.md §10.1. Use these everywhere; never inline
 * a bespoke easing/duration in a component file.
 */

import type { Transition, Variants } from 'framer-motion';

export const ease = {
    /** Forest ledger ease — the reference's cubic-bezier(.2,.8,.2,1). Default for reveals and hovers. */
    out: [0.2, 0.8, 0.2, 1] as const,
    /** Expo out — snappier, for micro-interactions. */
    expo: [0.16, 1, 0.3, 1] as const,
    inOut: [0.65, 0, 0.35, 1] as const,
    /** Spring used for tactile/physical motion (button press, drawer). */
    spring: { type: 'spring', stiffness: 260, damping: 24 } satisfies Transition,
} as const;

export const durations = {
    micro: 0.18,
    short: 0.32,
    medium: 0.6,
    long: 1.2,
} as const;

/**
 * Default reveal variants — the one entrance: fade + 18px rise over 0.9s. Used by `<ScrollReveal>` and
 * any component that wants a consistent enter animation.
 */
export const revealVariants: Variants = {
    hidden: { opacity: 0, y: 18 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: durations.medium, ease: ease.out },
    },
};

/** Stagger children inside a reveal container by 80ms. */
export const staggerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.08, delayChildren: 0.1 },
    },
};
