'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../cn';
import { ease } from '../motion';

interface TickPopProps {
    /** Diameter in px. */
    size?: number;
    /** Announced to screen readers, e.g. "Booking confirmed". */
    label?: string;
    className?: string;
}

/**
 * Success moment — booking confirmed, order paid, settings saved. The tick
 * draws its stroke (220ms), then the badge does one small spring bounce.
 * Static (fully drawn) under reduced motion. Re-mount (change `key`) to replay.
 */
export function TickPop({ size = 56, label = 'Done', className }: TickPopProps) {
    const reduce = useReducedMotion();
    return (
        <motion.span
            role="img"
            aria-label={label}
            className={cn('inline-flex items-center justify-center rounded-full bg-success text-white', className)}
            style={{ width: size, height: size }}
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={reduce ? undefined : { scale: [0.6, 1, 1.12, 1], opacity: 1 }}
            transition={reduce ? undefined : { duration: 0.5, times: [0, 0.35, 0.7, 1], ease: ease.out }}
        >
            <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" aria-hidden>
                <motion.path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="currentColor"
                    strokeWidth={2.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={reduce ? undefined : { duration: 0.22, delay: 0.12, ease: ease.out }}
                />
            </svg>
        </motion.span>
    );
}
