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
        // White card on cream: label, green icon chip, big Bricolage figure.
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
                'rounded-card border border-border bg-surface p-4 sm:p-5 text-text shadow-card',
                className,
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate pt-1 text-[14px] font-medium text-muted">{name}</p>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:!text-primary">
                    {icon}
                </div>
            </div>

            <p className="mt-4 sm:mt-5 font-sans text-[1.75rem] sm:text-[2rem] font-bold tracking-[-0.02em] text-text tabular-nums leading-none">
                {typeof value === 'number' ? <NumberTicker value={value} /> : value}
            </p>
            {change && change.direction !== 'neutral' ? (
                <div className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
                    <ChangePill change={change} />
                    {change.label && <span className="truncate">{change.label}</span>}
                </div>
            ) : (
                <div className="mt-3 h-[3px] w-8 rounded-full bg-accent" aria-hidden />
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
                'inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[12px] font-semibold leading-none tabular-nums',
                up ? 'bg-success-soft text-success-fg' : 'bg-error-soft text-error-fg',
            )}
        >
            <Icon className="h-3 w-3" aria-hidden />
            {up ? '+' : ''}{change.value.toFixed(1)}%
        </span>
    );
}
