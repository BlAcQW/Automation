'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { CEDI_SYMBOL, parseCedi } from '../format';
import { controlClasses, controlErrorClasses, describedBy, FieldLabel, FieldMessages, useFieldIds } from './field';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    /** The text as typed (keep it as a string so "12." can be typed). */
    value: string;
    /** `amount` is the parsed number of cedis, or null while empty/invalid. */
    onChange: (text: string, amount: number | null) => void;
}

/**
 * Cedi amount field: a fixed `GH₵` prefix, decimal keyboard on phones,
 * digits / one dot / commas only. Display stored amounts with formatCedi().
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
    ({ label, hint, error, id, value, onChange, className, required, ...props }, ref) => {
        const ids = useFieldIds(id);
        return (
            <div className="space-y-1.5">
                {label && <FieldLabel htmlFor={ids.inputId} required={required}>{label}</FieldLabel>}
                <div className="relative">
                    <span
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted"
                        aria-hidden
                    >
                        {CEDI_SYMBOL}
                    </span>
                    <input
                        ref={ref}
                        id={ids.inputId}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.00"
                        required={required}
                        value={value}
                        onChange={(e) => {
                            const text = e.target.value.replace(/[^\d.,]/g, '');
                            onChange(text, parseCedi(text));
                        }}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(ids, hint, error)}
                        className={cn(controlClasses, 'pl-14 tabular-nums', error && controlErrorClasses, className)}
                        {...props}
                    />
                </div>
                <FieldMessages hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
            </div>
        );
    }
);
MoneyInput.displayName = 'MoneyInput';
