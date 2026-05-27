'use client';

import { cn } from '@/lib/cn';

interface SwitchProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    /** Accessible label for screen readers. */
    label?: string;
}

/**
 * Minimal accessible on/off switch. No external dependency — a styled
 * <button role="switch"> with a sliding thumb.
 */
export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
                disabled && 'opacity-50 cursor-not-allowed',
                checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
            )}
        >
            <span
                className={cn(
                    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                    checked ? 'translate-x-5' : 'translate-x-0.5',
                )}
            />
        </button>
    );
}
