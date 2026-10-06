'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from '@bookingflow/ui';

/** A titled panel in the admin's card style. */
export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-2xl border border-white/5 glass-card overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-white/5 px-6 py-4">
                <h2 className="text-base font-semibold text-white">{title}</h2>
                {action}
            </header>
            <div>{children}</div>
        </section>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="px-6 py-8 text-center text-sm text-slate-500">{children}</p>;
}

/** A section whose query failed server-side: say so instead of showing an empty list. */
export function Unavailable() {
    return (
        <p className="flex items-center justify-center gap-2 px-6 py-8 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4" /> This section could not be loaded. Try again shortly.
        </p>
    );
}

export function isUnavailable(section: unknown): section is { error: 'unavailable' } {
    return !!section && typeof section === 'object' && (section as { error?: string }).error === 'unavailable';
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
    return <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400 ${className}`}>{children}</th>;
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
    return <td className={`px-6 py-3 text-sm text-slate-300 ${className}`}>{children}</td>;
}

export function Table({ children }: { children: ReactNode }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full">{children}</table>
        </div>
    );
}

/** A thin usage bar; turns amber then red as it fills. */
export function UsageBar({ percent }: { percent: number }) {
    const clamped = Math.max(0, Math.min(100, percent));
    const colour = clamped >= 95 ? 'bg-rose-500' : clamped >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
    return (
        <div className="h-2 w-full rounded-full bg-slate-700" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
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
                {description && <div className="text-sm text-slate-400">{description}</div>}
                <div className="space-y-1.5">
                    <label htmlFor="reason" className="block text-sm font-medium text-slate-300">Reason {reasonRequired ? '(recorded in the audit log)' : '(optional)'}</label>
                    <textarea
                        id="reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={300}
                        rows={3}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                        placeholder="Why is this needed?"
                    />
                    {reasonRequired && !valid && trimmed.length > 0 && (
                        <p className="text-xs text-amber-300">At least {minLength} characters.</p>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="destructive" disabled={!valid || busy} isLoading={busy}>{confirmLabel}</Button>
                </div>
            </form>
        </Modal>
    );
}
