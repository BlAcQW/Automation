'use client';

import { type ReactNode } from 'react';
import { cn } from '../cn';

export interface Column<T> {
    key: string;
    header: string;
    /** Cell content. */
    render: (row: T) => ReactNode;
    /** Right-align numbers and money. */
    align?: 'left' | 'right';
    /** Hide on the mobile card (keep cards short — 3–4 fields). */
    hideOnMobile?: boolean;
    className?: string;
}

interface ResponsiveTableProps<T> {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    /** Accessible table caption (visually hidden). */
    caption: string;
    onRowClick?: (row: T) => void;
    /** Mobile card title (defaults to the first column). */
    cardTitle?: (row: T) => ReactNode;
    className?: string;
}

/**
 * A real <table> from `md` up; a stack of cards below it — no horizontal
 * scroll on phones. Rows are clickable when `onRowClick` is given (the
 * card becomes a button, the row gets a hover state).
 */
export function ResponsiveTable<T>({ columns, rows, rowKey, caption, onRowClick, cardTitle, className }: ResponsiveTableProps<T>) {
    const [first, ...rest] = columns;
    return (
        <div className={className}>
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface shadow-card md:block">
                <table className="w-full text-left text-[15px]">
                    <caption className="sr-only">{caption}</caption>
                    <thead className="bg-surface-2 text-[13px] font-semibold text-muted">
                        <tr>
                            {columns.map((c) => (
                                <th key={c.key} scope="col" className={cn('px-4 py-3', c.align === 'right' && 'text-right', c.className)}>
                                    {c.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {rows.map((row) => (
                            <tr
                                key={rowKey(row)}
                                onClick={onRowClick ? () => onRowClick(row) : undefined}
                                className={cn(onRowClick && 'cursor-pointer transition-colors hover:bg-surface-2')}
                            >
                                {columns.map((c) => (
                                    <td key={c.key} className={cn('px-4 py-3.5 text-text', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                                        {c.render(row)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <ul className="space-y-3 md:hidden" aria-label={caption}>
                {rows.map((row) => {
                    const body = (
                        <>
                            <div className="text-[16px] font-bold text-text">{cardTitle ? cardTitle(row) : first.render(row)}</div>
                            <dl className="mt-2 space-y-1.5">
                                {rest.filter((c) => !c.hideOnMobile).map((c) => (
                                    <div key={c.key} className="flex items-center justify-between gap-3 text-[15px]">
                                        <dt className="text-muted">{c.header}</dt>
                                        <dd className={cn('text-right text-text', c.align === 'right' && 'tabular-nums')}>{c.render(row)}</dd>
                                    </div>
                                ))}
                            </dl>
                        </>
                    );
                    return (
                        <li key={rowKey(row)}>
                            {onRowClick ? (
                                <button
                                    type="button"
                                    onClick={() => onRowClick(row)}
                                    className="block w-full rounded-card border border-border bg-surface p-4 text-left shadow-card transition-shadow active:shadow-soft"
                                >
                                    {body}
                                </button>
                            ) : (
                                <div className="rounded-card border border-border bg-surface p-4 shadow-card">{body}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
