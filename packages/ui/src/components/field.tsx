'use client';

import {
    forwardRef,
    useId,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../cn';

/**
 * Shared look for every text-like control: 12px corners, 48px tall, 16px
 * text (no iOS zoom), white on cream, green border on focus + gold outline
 * from the global :focus-visible rule.
 */
export const controlClasses =
    'w-full min-h-[48px] rounded-control border border-border bg-surface px-4 py-3 text-base text-text placeholder:text-muted/80 transition-[border-color,box-shadow] duration-ui ease-brand-out hover:border-text/25 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60';

export const controlErrorClasses = 'border-error focus:border-error focus:ring-error/15';

/** ids for label / hint / error wiring, derived from an explicit id or generated. */
export function useFieldIds(id?: string) {
    const auto = useId();
    const base = id ?? `f${auto.replace(/:/g, '')}`;
    return { inputId: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

export function describedBy(ids: ReturnType<typeof useFieldIds>, hint?: ReactNode, error?: ReactNode) {
    const parts = [hint ? ids.hintId : null, error ? ids.errorId : null].filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
}

interface FieldMessageProps {
    hintId: string;
    errorId: string;
    hint?: ReactNode;
    error?: ReactNode;
}

/** Hint (muted) and inline error (red, with icon — never colour alone). */
export function FieldMessages({ hintId, errorId, hint, error }: FieldMessageProps) {
    return (
        <>
            {hint && !error && (
                <p id={hintId} className="text-[14px] leading-snug text-muted">
                    {hint}
                </p>
            )}
            {error && (
                <p id={errorId} role="alert" className="ui-field-error flex items-start gap-1.5 text-[14px] font-medium leading-snug text-error-fg">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{error}</span>
                </p>
            )}
        </>
    );
}

export function FieldLabel({ htmlFor, children, required }: { htmlFor: string; children: ReactNode; required?: boolean }) {
    return (
        <label htmlFor={htmlFor} className="block text-[14px] font-semibold text-text">
            {children}
            {required && <span className="ml-0.5 text-error-fg" aria-hidden>*</span>}
        </label>
    );
}

interface FieldProps {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    required?: boolean;
    /** id of the control inside; pass the same id to the control. */
    htmlFor: string;
    className?: string;
    children: ReactNode;
}

/**
 * Wraps any control with label + hint + inline error. For custom controls;
 * Input / Select / Textarea / PhoneInput / MoneyInput already include it.
 * Give the control `aria-describedby={`${htmlFor}-hint ${htmlFor}-error`}`.
 */
export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
    return (
        <div className={cn('space-y-1.5', className)}>
            {label && <FieldLabel htmlFor={htmlFor} required={required}>{label}</FieldLabel>}
            {children}
            <FieldMessages hintId={`${htmlFor}-hint`} errorId={`${htmlFor}-error`} hint={hint} error={error} />
        </div>
    );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
    ({ label, hint, error, id, className, children, required, ...props }, ref) => {
        const ids = useFieldIds(id);
        return (
            <div className="space-y-1.5">
                {label && <FieldLabel htmlFor={ids.inputId} required={required}>{label}</FieldLabel>}
                <div className="relative">
                    <select
                        ref={ref}
                        id={ids.inputId}
                        required={required}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={describedBy(ids, hint, error)}
                        className={cn(controlClasses, 'appearance-none pr-11', error && controlErrorClasses, className)}
                        {...props}
                    >
                        {children}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
                </div>
                <FieldMessages hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
            </div>
        );
    }
);
Select.displayName = 'Select';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, hint, error, id, className, required, rows = 4, ...props }, ref) => {
        const ids = useFieldIds(id);
        return (
            <div className="space-y-1.5">
                {label && <FieldLabel htmlFor={ids.inputId} required={required}>{label}</FieldLabel>}
                <textarea
                    ref={ref}
                    id={ids.inputId}
                    rows={rows}
                    required={required}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy(ids, hint, error)}
                    className={cn(controlClasses, 'resize-y leading-relaxed', error && controlErrorClasses, className)}
                    {...props}
                />
                <FieldMessages hintId={ids.hintId} errorId={ids.errorId} hint={hint} error={error} />
            </div>
        );
    }
);
Textarea.displayName = 'Textarea';
