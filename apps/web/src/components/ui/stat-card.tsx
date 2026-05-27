'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface StatCardProps {
    name: string;
    value: string | number;
    icon: ReactNode;
    /** Tinted background utility for the icon square — e.g. `bg-blue-500`. */
    color: string;
    className?: string;
    index?: number;
    /**
     * Optional period-over-period change pill shown top-right. `direction:
     * 'neutral'` renders a slate "Active"-style chip when there's no delta.
     */
    change?: {
        value: number;
        direction: 'up' | 'down' | 'neutral';
        label?: string;
    };
}

export function StatCard({ name, value, icon, color, className, index = 0, change }: StatCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.1 }}
            className={cn(
                'relative overflow-hidden bg-ink-900 rounded-2xl border border-ink-700/70 p-5 group hover:shadow-card-hover hover:border-bookly-emerald-500/30 transition-all duration-300',
                className,
            )}
        >
            {/* Subtle gradient background tint */}
            <div className={cn('absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-10 -translate-y-8 translate-x-8 group-hover:opacity-20 transition-opacity', color)} />

            {/* Top row: icon left, optional change pill right */}
            <div className="relative flex items-start justify-between">
                <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shadow-md', color)}>
                    {icon}
                </div>
                {change && <ChangePill change={change} />}
            </div>

            <div className="relative mt-4">
                <p className="text-caption uppercase tracking-wider text-ink-300">
                    {name}
                </p>
                <p className="font-display text-2xl font-bold text-ink-50 mt-1 tracking-tight tabular-nums">
                    {value}
                </p>
            </div>
        </motion.div>
    );
}

function ChangePill({ change }: { change: NonNullable<StatCardProps['change']> }) {
    if (change.direction === 'neutral') {
        return (
            <span className="inline-flex items-center rounded-full bg-ink-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-200">
                {change.label ?? 'Active'}
            </span>
        );
    }
    const up = change.direction === 'up';
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
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
