'use client';

import { type ReactNode } from 'react';
import { RotateCcw, CloudOff } from 'lucide-react';
import { cn } from '../cn';
import { Button } from './button';

interface EmptyStateProps {
    /** A Lucide icon element, e.g. <CalendarPlus />. */
    icon?: ReactNode;
    /** Short and friendly: "No bookings yet". */
    title: string;
    /** What to do next: "Share your WhatsApp link to get your first one!" */
    description?: ReactNode;
    /** Usually a <Button>. One clear next step. */
    action?: ReactNode;
    className?: string;
}

/** Helpful empty state: icon, title, one line, one button. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
            {icon && (
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card bg-primary-soft text-primary [&_svg]:h-7 [&_svg]:w-7" aria-hidden>
                    {icon}
                </div>
            )}
            <h3 className="text-[18px] font-bold text-text">{title}</h3>
            {description && <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-muted">{description}</p>}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

interface ErrorStateProps {
    title?: string;
    /** Next steps in plain words. */
    description?: ReactNode;
    onRetry?: () => void;
    retryLabel?: string;
    isRetrying?: boolean;
    className?: string;
}

/** Friendly error with a retry. Never show raw error codes to owners. */
export function ErrorState({
    title = "Oops, that didn't work. Let's try again.",
    description = 'Check your internet connection, then tap Try again. If it keeps happening, contact support.',
    onRetry,
    retryLabel = 'Try again',
    isRetrying,
    className,
}: ErrorStateProps) {
    return (
        <div role="alert" className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card bg-error-soft text-error-fg" aria-hidden>
                <CloudOff className="h-7 w-7" />
            </div>
            <h3 className="max-w-sm text-[18px] font-bold text-text">{title}</h3>
            {description && <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-muted">{description}</p>}
            {onRetry && (
                <Button variant="secondary" className="mt-5" onClick={onRetry} isLoading={isRetrying}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    {retryLabel}
                </Button>
            )}
        </div>
    );
}
