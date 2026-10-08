'use client';

import { useMotionTemplate, useMotionValue, motion } from 'framer-motion';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@bookingflow/ui';

interface Props {
    children: ReactNode;
    className?: string;
    as?: 'article' | 'div' | 'li';
}

/**
 * A card whose border and surface light up under the pointer (the Aceternity
 * "spotlight" hover). The highlight is a motion value, not React state, so
 * moving the mouse never re-renders the card. Touch devices simply get the
 * static card.
 */
export function SpotlightCard({ children, className, as = 'article' }: Props) {
    const x = useMotionValue(-400);
    const y = useMotionValue(-400);

    function onMove({ currentTarget, clientX, clientY }: MouseEvent<HTMLElement>) {
        const r = currentTarget.getBoundingClientRect();
        x.set(clientX - r.left);
        y.set(clientY - r.top);
    }

    // A faint ink sheen under the pointer — light in the room, never a halo.
    const glow = useMotionTemplate`radial-gradient(260px circle at ${x}px ${y}px, rgb(var(--ink-50-rgb) / 0.045), transparent 70%)`;
    const Tag = motion[as] as typeof motion.article;

    return (
        <Tag
            onMouseMove={onMove}
            onMouseLeave={() => { x.set(-400); y.set(-400); }}
            className={cn(
                'group/spot relative overflow-hidden rounded-xl bg-ink-900 shadow-card transition-[box-shadow,transform] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] hover:shadow-card-hover hover:-translate-y-0.5',
                className,
            )}
        >
            <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
                style={{ background: glow }}
            />
            <div className="relative">{children}</div>
        </Tag>
    );
}
