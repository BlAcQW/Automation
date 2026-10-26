'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { formatGhanaPhoneInput, normalizeGhanaPhone, GHANA_DIAL_CODE } from '../format';
import { controlClasses, controlErrorClasses, describedBy, FieldLabel, FieldMessages, useFieldIds } from './field';

interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    /** Any spelling of the number; shown grouped after a fixed +233. */
    value: string;
    /**
     * Called on every keystroke. `display` is what the user sees (`24 412 3456`);
     * `e164` is `+233244123456` once the number is complete and valid, else null.
     */
    onChange: (display: string, e164: string | null) => void;
}

/**
 * Ghana phone field: a fixed `+233` prefix and the national number grouped
 * as `24 412 3456` while typing (a leading 0 is accepted and dropped).
 * Store `e164`; validate with isValidGhanaPhone().
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
    ({ label = 'Phone number', hint, error, id, value, onChange, className, required, ...props }, ref) => {
        const ids = useFieldIds(id);
        return (
            <div className="space-y-1.5">
                {label && <FieldLabel htmlFor={ids.inputId} required={required}>{label}</FieldLabel>}
                <div className="relative">
                    <span
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 border-r border-border pr-3 text-base font-medium text-muted"
                        aria-hidden
                    >
                        {GHANA_DIAL_CODE}
                    </span>
                    <input
                        ref={ref}
                        id={ids.inputId}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="24 412 3456"
                        required={required}
                        value={formatGhanaPhoneInput(value)}
                        onChange={(e) => {
                            const display = formatGhanaPhoneInput(e.target.value);
                            onChange(display, normalizeGhanaPhone(display));
                        }}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(ids, hint, error)}
                        className={cn(controlClasses, 'pl-[5.25rem] tabular-nums tracking-wide', error && controlErrorClasses, className)}
                        {...props}
                    />
                </div>
                <FieldMessages hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
            </div>
        );
    }
);
PhoneInput.displayName = 'PhoneInput';
