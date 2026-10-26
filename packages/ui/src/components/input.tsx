'use client';

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../cn';
import { controlClasses, controlErrorClasses, describedBy, FieldLabel, FieldMessages, useFieldIds } from './field';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    icon?: ReactNode;
    error?: string;
    label?: string;
    /** Helper text under the field (hidden while an error shows). */
    hint?: ReactNode;
}

/** Keeps the historic behaviour: an explicit id, else one derived from the label. */
function useInputIds(id?: string, label?: string) {
    return useFieldIds(id || label?.toLowerCase().replace(/\s+/g, '-'));
}

/**
 * Text input with label, hint and inline error. Password fields get a
 * show/hide toggle automatically: typing a password blind on a phone
 * keyboard is the single most common reason a sign-up fails.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, icon, error, label, hint, id, type, required, ...props }, ref) => {
        const ids = useInputIds(id, label);
        const isPassword = type === 'password';
        const [revealed, setRevealed] = useState(false);
        const resolvedType = isPassword && revealed ? 'text' : type;

        return (
            <div className="space-y-1.5">
                {label && <FieldLabel htmlFor={ids.inputId} required={required}>{label}</FieldLabel>}
                <div className="relative group">
                    {icon && (
                        <div className="ui-field-icon pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary [&_svg]:h-5 [&_svg]:w-5">
                            {icon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        id={ids.inputId}
                        type={resolvedType}
                        required={required}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(ids, hint, error)}
                        className={cn(
                            controlClasses,
                            icon && 'pl-12',
                            isPassword && 'pr-12',
                            error && controlErrorClasses,
                            className
                        )}
                        {...props}
                    />
                    {isPassword && (
                        <button
                            type="button"
                            onClick={() => setRevealed((v) => !v)}
                            aria-label={revealed ? 'Hide password' : 'Show password'}
                            aria-pressed={revealed}
                            className="absolute right-1 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-control text-muted hover:text-text hover:bg-text/[0.06] transition-colors"
                        >
                            {revealed ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                    )}
                </div>
                <FieldMessages hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
            </div>
        );
    }
);

Input.displayName = 'Input';

interface DashboardInputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    icon?: ReactNode;
    error?: string;
    hint?: ReactNode;
}

/** Dashboard form input. Same brand control; icon sits a little tighter. */
const DashboardInput = forwardRef<HTMLInputElement, DashboardInputProps>(
    ({ className, label, icon, error, hint, id, required, ...props }, ref) => {
        const ids = useInputIds(id, label);
        return (
            <div className="space-y-1.5">
                {label && <FieldLabel htmlFor={ids.inputId} required={required}>{label}</FieldLabel>}
                <div className="relative group">
                    {icon && (
                        <div className="ui-field-icon pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary [&_svg]:h-[18px] [&_svg]:w-[18px]">
                            {icon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        id={ids.inputId}
                        required={required}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(ids, hint, error)}
                        className={cn(controlClasses, icon && 'pl-11', error && controlErrorClasses, className)}
                        {...props}
                    />
                </div>
                <FieldMessages hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
            </div>
        );
    }
);

DashboardInput.displayName = 'DashboardInput';

export { Input, DashboardInput };
