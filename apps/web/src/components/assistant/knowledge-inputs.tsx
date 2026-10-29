'use client';

/**
 * Inputs for the knowledge form: a text field with a character counter that
 * appears as it nears its limit, and the counter itself (shared with the
 * team and FAQ editors).
 */
import { DashboardInput, Textarea, cn } from '@bookingflow/ui';

/** Shown from 80% of the limit, so short answers stay uncluttered. */
export function CharCount({ value, limit, id }: { value: string; limit: number; id?: string }) {
    const used = value.length;
    if (used < limit * 0.8) return null;
    const left = limit - used;
    return (
        <p id={id} aria-live="polite" className={cn('text-right text-[13px] tabular-nums', left <= 0 ? 'font-semibold text-error-fg' : 'text-muted')}>
            {left <= 0 ? `Limit reached (${limit.toLocaleString('en-GB')})` : `${left.toLocaleString('en-GB')} characters left`}
        </p>
    );
}

interface KnowledgeTextFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    limit: number;
    placeholder?: string;
    hint?: string;
    error?: string;
    multiline?: boolean;
    disabled?: boolean;
    type?: 'text' | 'url';
}

export function KnowledgeTextField({
    id, label, value, onChange, limit, placeholder, hint, error, multiline, disabled, type = 'text',
}: KnowledgeTextFieldProps) {
    const common = {
        id,
        label,
        value,
        placeholder,
        hint,
        error,
        disabled,
        maxLength: limit,
    };
    return (
        <div className="space-y-1">
            {multiline ? (
                <Textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
            ) : (
                <DashboardInput
                    {...common}
                    type={type}
                    inputMode={type === 'url' ? 'url' : undefined}
                    autoComplete="off"
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
            <CharCount value={value} limit={limit} />
        </div>
    );
}
