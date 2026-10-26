'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Modal, Skeleton, SkeletonLine, Textarea, cn } from '@bookingflow/ui';

/** A titled panel in the admin's card style. */
export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
                <h2 className="text-[17px] font-bold text-text">{title}</h2>
                {action}
            </header>
            <div>{children}</div>
        </section>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="px-4 py-8 text-center text-[15px] text-muted sm:px-6">{children}</p>;
}

/** A section whose query failed server-side: say so instead of showing an empty list. */
export function Unavailable() {
    return (
        <p className="flex items-center justify-center gap-2 px-4 py-8 text-center text-[15px] text-warning-fg sm:px-6">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> This section couldn&apos;t load. Try again shortly.
        </p>
    );
}

export function isUnavailable(section: unknown): section is { error: 'unavailable' } {
    return !!section && typeof section === 'object' && (section as { error?: string }).error === 'unavailable';
}

/*
 * Responsive table: a real <table> from md up; below md each row becomes a
 * stacked card and every cell shows its `label` (pass the column name to Td).
 */
export function Table({ children }: { children: ReactNode }) {
    return (
        <div className="md:overflow-x-auto">
            <table className="block w-full md:table [&>tbody]:block md:[&>tbody]:table-row-group">{children}</table>
        </div>
    );
}

export function THead({ children }: { children: ReactNode }) {
    return <thead className="hidden bg-surface-2 md:table-header-group">{children}</thead>;
}

export function Tr({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <tr className={cn('block border-t border-border px-4 py-3 transition-colors hover:bg-surface-2 md:table-row md:p-0', className)}>
            {children}
        </tr>
    );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
    return <th className={cn('px-6 py-3 text-left text-[13px] font-semibold text-muted', className)}>{children}</th>;
}

export function Td({ children, className = '', label }: { children?: ReactNode; className?: string; label?: string }) {
    return (
        <td className={cn('flex items-start justify-between gap-4 py-1.5 text-[15px] text-text md:table-cell md:px-6 md:py-3', className)}>
            {label && <span className="shrink-0 text-[13px] font-medium text-muted md:hidden">{label}</span>}
            <div className={cn('min-w-0', label ? 'text-right md:text-left' : 'flex-1')}>{children}</div>
        </td>
    );
}

/** Skeleton block for a panel/table while it loads. */
export function LoadingBlock({ rows = 4, label = 'Loading…' }: { rows?: number; label?: string }) {
    return (
        <div aria-busy="true" className="space-y-4 rounded-card border border-border bg-surface p-5 shadow-card sm:p-6">
            <span className="sr-only">{label}</span>
            <Skeleton className="h-6 w-1/3" />
            {Array.from({ length: rows }).map((_, i) => (
                <SkeletonLine key={i} width={i % 2 ? 'w-4/5' : 'w-full'} />
            ))}
        </div>
    );
}

/** Previous / next pager under a list. */
export function Pager({
    page, totalPages, onPage, summary,
}: { page: number; totalPages: number; onPage: (page: number) => void; summary?: ReactNode }) {
    return (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {summary ? <p className="text-[14px] text-muted">{summary}</p> : <span />}
            <div className="flex items-center gap-2">
                <Button variant="secondary" size="icon" aria-label="Previous page" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <span className="px-2 text-[14px] text-text">Page {page} of {Math.max(1, totalPages)}</span>
                <Button variant="secondary" size="icon" aria-label="Next page" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
                    <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
            </div>
        </div>
    );
}

/** A thin usage bar; turns gold then red as it fills. */
export function UsageBar({ percent }: { percent: number }) {
    const clamped = Math.max(0, Math.min(100, percent));
    const colour = clamped >= 95 ? 'bg-error' : clamped >= 80 ? 'bg-warning' : 'bg-success';
    return (
        <div className="h-2 w-full rounded-full bg-surface-2" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-2 rounded-full ${colour}`} style={{ width: `${clamped}%` }} />
        </div>
    );
}

/**
 * Confirmation dialog that insists on a written reason: emergency switches and
 * support access are audited with it. The caller does the request.
 */
export function ReasonModal({
    isOpen, title, description, confirmLabel, reasonRequired = true, minLength = 5, busy, onClose, onConfirm,
}: {
    isOpen: boolean;
    title: string;
    description?: ReactNode;
    confirmLabel: string;
    reasonRequired?: boolean;
    minLength?: number;
    busy?: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState('');
    useEffect(() => { if (!isOpen) setReason(''); }, [isOpen]);
    const trimmed = reason.trim();
    const valid = !reasonRequired || trimmed.length >= minLength;
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (valid) onConfirm(trimmed);
                }}
            >
                {description && <div className="text-[15px] text-muted">{description}</div>}
                <Textarea
                    id="reason"
                    label={`Reason ${reasonRequired ? '(saved in the audit log)' : '(optional)'}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={300}
                    rows={3}
                    placeholder="Why is this needed?"
                    error={reasonRequired && !valid && trimmed.length > 0 ? `Please write at least ${minLength} characters.` : undefined}
                />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="destructive" disabled={!valid || busy} isLoading={busy}>{confirmLabel}</Button>
                </div>
            </form>
        </Modal>
    );
}
