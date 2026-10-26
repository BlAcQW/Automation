'use client';

import { useCallback, useState, type FocusEvent, type FormEvent } from 'react';

type Control = HTMLInputElement;

export interface FieldMessages {
    /** Shown when the field is empty but required. */
    missing?: string;
    /** Shown when an email (or other typed value) is not in the right shape. */
    format?: string;
    /** Shown when the value is shorter than `minLength`. */
    short?: string;
}

/**
 * Turns the browser's own constraint checks (required, type="email",
 * minLength) into friendly inline messages under each field. It does not add
 * any new rule: it only reads `input.validity`, so validation stays exactly
 * what the markup says.
 *
 * - On blur: the message appears once the person leaves a field.
 * - On submit: `onInvalid` fires for every invalid field; we show the inline
 *   message instead of the native bubble and move focus to the first one.
 * - While typing: an existing message is re-checked so it clears as soon as
 *   the value is fixed.
 */
export function useInlineValidation() {
    const [errors, setErrors] = useState<Record<string, string | undefined>>({});

    const messageFor = useCallback((el: Control, m: FieldMessages): string | undefined => {
        const v = el.validity;
        if (v.valid) return undefined;
        if (v.valueMissing) return m.missing ?? 'Please fill this in.';
        if (v.typeMismatch || v.patternMismatch) return m.format ?? "That doesn't look quite right.";
        if (v.tooShort) return m.short ?? `Use at least ${el.minLength} characters.`;
        return el.validationMessage || "That doesn't look quite right.";
    }, []);

    const set = useCallback((name: string, msg: string | undefined) => {
        setErrors((prev) => (prev[name] === msg ? prev : { ...prev, [name]: msg }));
    }, []);

    const field = useCallback(
        (name: string, m: FieldMessages = {}) => ({
            /** Spread onto the input: error text + blur/invalid handlers. */
            props: {
                error: errors[name],
                onBlur: (e: FocusEvent<Control>) => {
                    // Don't nag an untouched empty field when someone just tabs through.
                    if (e.currentTarget.value === '' && !errors[name]) return;
                    set(name, messageFor(e.currentTarget, m));
                },
                onInvalid: (e: FormEvent<Control>) => {
                    e.preventDefault();
                    const el = e.currentTarget;
                    set(name, messageFor(el, m));
                    const active = document.activeElement as Control | null;
                    if (!active || !('validity' in active) || active.validity.valid) el.focus();
                },
            },
            /** Call from the field's onChange to clear the message once it's fixed. */
            recheck: (el: Control) => {
                if (errors[name]) set(name, messageFor(el, m));
            },
        }),
        [errors, messageFor, set],
    );

    return { field, errors };
}
