'use client';

import { cn } from '../cn';

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
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
                disabled && 'opacity-50 cursor-not-allowed',
                checked
                    ? 'bg-accent-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] dark:bg-accent-500'
                    : 'bg-ink-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]',
            )}
        >
            <span
                className={cn(
                    'inline-block h-5 w-5 transform rounded-full bg-[#FBFAF7] shadow-[0_1px_3px_rgba(20,26,22,0.3)] transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)]',
                    checked ? 'translate-x-5' : 'translate-x-0.5',
                )}
            />
        </button>
    );
}
