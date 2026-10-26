'use client';

import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../cn';

export interface TabItem {
    value: string;
    label: ReactNode;
    /** Optional count shown in a small pill. */
    count?: number;
}

interface TabsProps {
    items: TabItem[];
    value: string;
    onChange: (value: string) => void;
    /** Accessible name for the tab list. */
    label: string;
    className?: string;
}

/**
 * Underlined tabs (scrolls sideways on phones). Arrow keys move between
 * tabs. Render the active panel yourself with `role="tabpanel"` and
 * `aria-labelledby={tabId(value)}` — see tabId().
 */
export function Tabs({ items, value, onChange, label, className }: TabsProps) {
    const base = useId().replace(/:/g, '');
    const reduce = useReducedMotion();
    const refs = useRef<(HTMLButtonElement | null)[]>([]);

    const onKey = (e: KeyboardEvent, index: number) => {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const next = (index + delta + items.length) % items.length;
        onChange(items[next].value);
        refs.current[next]?.focus();
    };

    return (
        <div role="tablist" aria-label={label} className={cn('scrollbar-hide flex gap-1 overflow-x-auto border-b border-border', className)}>
            {items.map((item, i) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        ref={(el) => { refs.current[i] = el; }}
                        type="button"
                        role="tab"
                        id={`${base}-tab-${item.value}`}
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(item.value)}
                        onKeyDown={(e) => onKey(e, i)}
                        className={cn(
                            'relative inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap px-3.5 text-[15px] font-semibold transition-colors',
                            active ? 'text-text' : 'text-muted hover:text-text',
                        )}
                    >
                        {item.label}
                        {typeof item.count === 'number' && (
                            <span className={cn('rounded-full px-2 py-0.5 text-[12px] tabular-nums', active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
                                {item.count}
                            </span>
                        )}
                        {active && (
                            <motion.span
                                layoutId={reduce ? undefined : `${base}-underline`}
                                className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-primary"
                                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
