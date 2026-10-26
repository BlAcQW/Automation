'use client';

import { FilterChips, type FilterChip } from '@bookingflow/ui';
import type { ChatFilter } from './types';

interface ChatFilterChipsProps {
    chips: FilterChip[];
    active: ChatFilter;
    onChange: (filter: ChatFilter) => void;
}

/** Single-select filter chips for the inbox list (scroll sideways on phones). */
export function ChatFilterChips({ chips, active, onChange }: ChatFilterChipsProps) {
    return (
        <FilterChips
            label="Filter chats"
            chips={chips}
            selected={[active]}
            onToggle={(value) => onChange(value as ChatFilter)}
        />
    );
}
