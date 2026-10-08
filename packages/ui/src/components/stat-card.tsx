'use client';

import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { NumberTicker } from './number-ticker';
import { cn } from '../cn';

interface StatCardProps {
    name: string;
    value: string | number;
    icon: ReactNode;
    /**
     * Accepted for backward compatibility and ignored. Every stat card uses
     * the one brand accent; four differently coloured icon squares on one
     * screen read as a rainbow, not as information.
     */
    color?: string;
    className?: string;
    index?: number;
    /**
     * Optional period-over-period change shown top-right. `direction:
     * 'neutral'` renders nothing: a pill that says "Active" next to a
     * number carries no information.
     */
    change?: {
        value: number;
        direction: 'up' | 'down' | 'neutral';
        label?: string;
    };
}

/**
 * One number, one label. Two-up on phones so the four headline stats fit
 * on one screen instead of four screens of zeros.
 */
export function StatCard({ name, value, icon, className, index = 0, change }: StatCardProps) {
    const reduce = useReducedMotion();
    return (
        // The reference's dark `.fs-stat`: night-green card, cream type, a big
        // light-weight tabular figure. Dark in both themes on purpose: it is
        // the one emphasis surface on a paper page.
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: index * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
            whileHover={reduce ? undefined : { y: -4, transition: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] } }}
            className={cn(
                'rounded-xl bg-[#1C2C22] p-3.5 sm:p-4 text-[#ECEBE1]',
                'shadow-[0_30px_50px_-28px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]',
                'dark:bg-[#1A2A20] dark:shadow-[0_0_0_1px_rgba(236,235,225,0.06),0_30px_50px_-28px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.05)]',
                className,
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate pt-0.5 text-[12px] font-medium tracking-[-0.01em] text-[#ECEBE1]/80">{name}</p>
                <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded bg-white/[0.08] text-[#ECEBE1] [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:!text-[#ECEBE1]">
                    {icon}
                </div>
            </div>

            <p className="mt-5 sm:mt-7 font-display text-[1.75rem] sm:text-[2.25rem] font-light tracking-[-0.04em] text-[#ECEBE1] tabular-nums leading-none">
                {typeof value === 'number' ? <NumberTicker value={value} /> : value}
            </p>
            {change && change.direction !== 'neutral' ? (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-[#ECEBE1]/60">
                    <ChangePill change={change} />
                    {change.label && <span className="truncate">{change.label}</span>}
                </div>
            ) : (
                <div className="mt-2.5 h-px w-8 bg-[#ECEBE1]/15" aria-hidden />
            )}
        </motion.div>
    );
}

function ChangePill({ change }: { change: NonNullable<StatCardProps['change']> }) {
    const up = change.direction === 'up';
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-[3px] text-[11px] font-medium leading-none tabular-nums',
                up
                    ? 'bg-[#2F5640] text-[#FBFAF7] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                    : 'bg-[#B03A2E] text-[#FBFAF7] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]',
            )}
        >
            <Icon className="h-3 w-3" />
            {up ? '+' : ''}{change.value.toFixed(1)}%
        </span>
    );
}
