'use client';

import { cn } from '@/lib/cn';
import type { ChatFilter } from './types';

interface ChatFilterChipsProps {
    active: ChatFilter;
    counts: Record<ChatFilter, number>;
    onChange: (filter: ChatFilter) => void;
}

const FILTERS: { key: ChatFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'bot', label: 'Bot' },
    { key: 'human', label: 'Human' },
];

/** Horizontally-scrollable segmented filter chips for the chat list. */
export function ChatFilterChips({ active, counts, onChange }: ChatFilterChipsProps) {
    return (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 py-1">
            {FILTERS.map(({ key, label }) => {
                const isActive = active === key;
                const count = counts[key];
                return (
                    <button
                        key={key}
                        onClick={() => onChange(key)}
                        className={cn(
                            'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
                            isActive
                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
                        )}
                    >
                        {label}
                        {count > 0 && (
                            <span
                                className={cn(
                                    'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold',
                                    isActive
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                                )}
                            >
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
