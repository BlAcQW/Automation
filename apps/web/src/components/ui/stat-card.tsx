'use client';

import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/cn';

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
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
                'rounded-2xl border border-ink-700/70 bg-ink-900 p-4 sm:p-5 transition-colors duration-200 hover:border-ink-600',
                className,
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-bookly-emerald-500/10 text-bookly-emerald-400 [&_svg]:!text-bookly-emerald-400">
                    {icon}
                </div>
                {change && change.direction !== 'neutral' && <ChangePill change={change} />}
            </div>

            <p className="mt-4 sm:mt-5 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink-50 tabular-nums leading-none">
                {value}
            </p>
            <p className="mt-1.5 text-[13px] text-ink-300">{name}</p>
        </motion.div>
    );
}

function ChangePill({ change }: { change: NonNullable<StatCardProps['change']> }) {
    const up = change.direction === 'up';
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums',
                up
                    ? 'bg-bookly-emerald-500/10 text-bookly-emerald-300'
                    : 'bg-rose-500/10 text-rose-300',
            )}
        >
            <Icon className="h-3 w-3" />
            {up ? '+' : ''}{change.value.toFixed(1)}%
        </span>
    );
}
