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
                // 28px track inside a 44px tap target (the button's own padding).
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-ui',
                'before:absolute before:-inset-2 before:content-[""]',
                disabled && 'opacity-50 cursor-not-allowed',
                checked ? 'bg-primary' : 'bg-text/20',
            )}
        >
            <span
                className={cn(
                    'inline-block h-6 w-6 transform rounded-full bg-white shadow-soft transition-transform duration-ui ease-brand-out',
                    checked ? 'translate-x-[22px]' : 'translate-x-0.5',
                )}
            />
        </button>
    );
}
