'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search, X, Check } from 'lucide-react';
import { cn } from '../cn';
import { controlClasses, useFieldIds } from './field';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
    value: string;
    onChange: (value: string) => void;
    /** Visually hidden label; the placeholder is not a label. */
    label?: string;
}

/** Search box with a clear button. Debounce in the page if it hits the API. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
    ({ value, onChange, label = 'Search', placeholder = 'Search…', className, id, ...props }, ref) => {
        const { inputId } = useFieldIds(id);
        return (
        <div className={cn('relative', className)}>
            <label className="sr-only" htmlFor={inputId}>{label}</label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
            <input
                ref={ref}
                id={inputId}
                type="search"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                className={cn(controlClasses, 'pl-12 pr-12 [&::-webkit-search-cancel-button]:hidden')}
                {...props}
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-text"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
        );
    },
);
SearchInput.displayName = 'SearchInput';

export interface FilterChip {
    value: string;
    label: string;
    count?: number;
}

interface FilterChipsProps {
    chips: FilterChip[];
    /** Selected values. Single-select pages pass one value. */
    selected: string[];
    onToggle: (value: string) => void;
    label: string;
    className?: string;
}

/** Horizontally scrolling filter chips (toggle buttons, ≥44px tall). */
export function FilterChips({ chips, selected, onToggle, label, className }: FilterChipsProps) {
    return (
        <div role="group" aria-label={label} className={cn('scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5', className)}>
            {chips.map((chip) => {
                const on = selected.includes(chip.value);
                return (
                    <button
                        key={chip.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onToggle(chip.value)}
                        className={cn(
                            'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition-colors duration-ui',
                            on
                                ? 'border-primary bg-primary text-primary-fg'
                                : 'border-border bg-surface text-text hover:border-text/30',
                        )}
                    >
                        {on && <Check className="h-4 w-4" strokeWidth={2.75} aria-hidden />}
                        {chip.label}
                        {typeof chip.count === 'number' && (
                            <span className={cn('tabular-nums', on ? 'text-primary-fg/80' : 'text-muted')}>{chip.count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
