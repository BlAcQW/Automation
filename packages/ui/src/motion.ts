/**
 * Shared motion tokens. Friendly, snappy, confident: 200–300ms for UI,
 * ≤500ms for page/hero. ease-out to enter, ease-in to leave; a light spring
 * only on ticks and icons. Use these everywhere — never inline a bespoke
 * easing or duration in a component file.
 */

import type { Transition, Variants } from 'framer-motion';

export const ease = {
    /** Enter / default: quick start, gentle settle. */
    out: [0.22, 1, 0.36, 1] as const,
    /** Leave: accelerate away. */
    in: [0.55, 0, 1, 0.45] as const,
    /** Alias kept for existing call sites. */
    expo: [0.16, 1, 0.3, 1] as const,
    inOut: [0.65, 0, 0.35, 1] as const,
    /** Light spring — ticks and icons only. */
    spring: { type: 'spring', stiffness: 420, damping: 18 } satisfies Transition,
} as const;

export const durations = {
    /** Hovers, presses, toggles. */
    micro: 0.2,
    /** Most UI: dropdowns, toasts, tabs. */
    short: 0.25,
    /** Modals, drawers, page transitions. */
    medium: 0.3,
    /** Hero / logo reveal ceiling. */
    long: 0.5,
} as const;

/** Stagger between list items / cards: 50–80ms. */
export const STAGGER_SECONDS = 0.06;

/** Page / block entrance: fade + 8px rise. */
export const revealVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: durations.medium, ease: ease.out },
    },
};

/** Stagger children inside a reveal container. */
export const staggerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: STAGGER_SECONDS, delayChildren: 0.04 },
    },
};

/** Button press: scale 0.97. */
export const pressScale = { scale: 0.97 } as const;
