'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Seconds before this element starts. Stagger siblings by ~0.06. */
    delay?: number;
    duration?: number;
    /** Only animate once it scrolls into view (default: on mount). */
    inView?: boolean;
    className?: string;
    as?: 'div' | 'span' | 'p' | 'h1' | 'h2' | 'li';
}

/**
 * Blur-and-rise entrance, the Magic UI "blur fade" pattern. Used to walk a
 * headline in word by word so the first screen reads as composed rather
 * than dumped. Collapses to a plain render under reduced motion.
 */
export function BlurFade({ children, delay = 0, duration = 0.5, inView = false, className, as = 'div' }: Props) {
    const reduce = useReducedMotion();
    const Tag = motion[as] as typeof motion.div;
    if (reduce) {
        const Plain = as;
        return <Plain className={className}>{children}</Plain>;
    }
    const target = { opacity: 1, y: 0, filter: 'blur(0px)' };
    return (
        <Tag
            className={className}
            initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
            {...(inView
                ? { whileInView: target, viewport: { once: true, amount: 0.4 } }
                : { animate: target })}
            transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }}
        >
            {children}
        </Tag>
    );
}

/** Splits a sentence and reveals it a word at a time. */
export function BlurFadeWords({ text, className, delay = 0, step = 0.05 }: { text: string; className?: string; delay?: number; step?: number }) {
    const words = text.split(' ');
    return (
        <span className={className} aria-label={text}>
            {words.map((w, i) => (
                <BlurFade key={`${w}-${i}`} as="span" delay={delay + i * step} className="inline-block whitespace-pre" >
                    {w}{i < words.length - 1 ? ' ' : ''}
                </BlurFade>
            ))}
        </span>
    );
}
