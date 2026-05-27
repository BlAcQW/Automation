import { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    /** Right-aligned slot for primary actions (buttons, etc.). */
    actions?: ReactNode;
    className?: string;
}

/**
 * Consistent page header used across every dashboard screen. Replaces the
 * ad-hoc `text-3xl font-bold bg-gradient...` blocks that were duplicated
 * (and drifting) on each page.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
    return (
        <div
            className={cn(
                'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
                className,
            )}
        >
            <div className="min-w-0">
                <h1 className="font-display text-h1 sm:text-display-md font-semibold tracking-tight text-ink-50">
                    {title}
                </h1>
                {subtitle && (
                    <p className="mt-1 text-body-sm text-ink-300">{subtitle}</p>
                )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
    );
}
