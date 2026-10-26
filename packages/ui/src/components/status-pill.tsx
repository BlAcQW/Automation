'use client';

import { type HTMLAttributes } from 'react';
import { Check, Clock, X, Minus, AlertTriangle, type LucideIcon } from 'lucide-react';
import { cn } from '../cn';

export type StatusTone = 'success' | 'warning' | 'error' | 'neutral';

/** Common domain statuses → tone. Anything else: pass `tone` explicitly. */
const STATUS_TONE: Record<string, StatusTone> = {
    confirmed: 'success',
    paid: 'success',
    completed: 'success',
    delivered: 'success',
    active: 'success',
    connected: 'success',
    success: 'success',
    pending: 'warning',
    processing: 'warning',
    awaiting_payment: 'warning',
    unpaid: 'warning',
    scheduled: 'warning',
    warning: 'warning',
    failed: 'error',
    declined: 'error',
    cancelled: 'error',
    canceled: 'error',
    expired: 'error',
    refunded: 'neutral',
    no_show: 'error',
    error: 'error',
    draft: 'neutral',
    inactive: 'neutral',
};

const TONE_STYLE: Record<StatusTone, { cls: string; Icon: LucideIcon }> = {
    success: { cls: 'bg-success-soft text-success-fg', Icon: Check },
    warning: { cls: 'bg-warning-soft text-warning-fg', Icon: Clock },
    error: { cls: 'bg-error-soft text-error-fg', Icon: X },
    neutral: { cls: 'bg-surface-2 text-muted', Icon: Minus },
};

function humanise(status: string) {
    const words = status.replace(/[_-]+/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
    /** e.g. 'confirmed', 'PAID', 'pending', 'failed'. Case-insensitive. */
    status: string;
    /** Override the tone the status maps to. */
    tone?: StatusTone;
    /** Override the visible text (defaults to the humanised status). */
    label?: string;
    size?: 'sm' | 'md';
}

/**
 * Status = icon + word + colour, never colour alone:
 * confirmed / paid → green tick, pending → gold clock, failed → red x.
 */
export function StatusPill({ status, tone, label, size = 'md', className, ...props }: StatusPillProps) {
    const key = status.toLowerCase();
    const resolved = tone ?? STATUS_TONE[key] ?? 'neutral';
    const { cls, Icon } = key === 'warning' ? { ...TONE_STYLE.warning, Icon: AlertTriangle } : TONE_STYLE[resolved];
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
                size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[13px]',
                cls,
                className,
            )}
            {...props}
        >
            <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.75} aria-hidden />
            {label ?? humanise(status)}
        </span>
    );
}
