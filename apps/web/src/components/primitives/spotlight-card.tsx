'use client';

import { useMotionTemplate, useMotionValue, motion } from 'framer-motion';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';

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

    const glow = useMotionTemplate`radial-gradient(260px circle at ${x}px ${y}px, rgba(16,185,129,0.14), transparent 70%)`;
    const Tag = motion[as] as typeof motion.article;

    return (
        <Tag
            onMouseMove={onMove}
            onMouseLeave={() => { x.set(-400); y.set(-400); }}
            className={cn(
                'group/spot relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 transition-colors duration-200 hover:border-ink-600',
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
