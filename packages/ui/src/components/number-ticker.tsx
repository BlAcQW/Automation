'use client';

import { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';

interface Props {
    value: number;
    /** Format the current frame value for display. Default: locale integer. */
    format?: (n: number) => string;
    duration?: number;
    className?: string;
}

/**
 * Counts up to `value` when it enters view (Magic UI "number ticker").
 * Motivation: the stat cards are the first thing on the dashboard; a number
 * that settles into place says "fresh data" better than one that pops in.
 * Static under reduced motion, and re-runs when the value changes.
 */
export function NumberTicker({ value, format, duration = 0.9, className }: Props) {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
    const reduce = useReducedMotion();
    const fmt = format ?? ((n: number) => Math.round(n).toLocaleString());

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (reduce || !inView) {
            el.textContent = fmt(value);
            return;
        }
        const controls = animate(0, value, {
            duration,
            ease: [0.16, 1, 0.3, 1],
            onUpdate: (v) => { el.textContent = fmt(v); },
        });
        return () => controls.stop();
    }, [value, inView, reduce, duration, fmt]);

    // Server render shows the final value so there is no flash of 0.
    return <span ref={ref} className={className}>{fmt(value)}</span>;
}
