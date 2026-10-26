'use client';

/**
 * Small building blocks shared by the settings connection cards (Paystack,
 * Payaza, Google Calendar, SMS, email): a connected / not connected status
 * row, a copyable value and a two-option segmented control.
 * Candidates for packages/ui once another page needs them.
 */
import { type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button, StatusPill, cn } from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';

interface ConnectionRowProps {
    connected: boolean;
    /** e.g. "Paystack", "Google Calendar". */
    name: string;
    icon: ReactNode;
    /** One line under the name: what it does, or the connection details. */
    detail?: ReactNode;
    /** Usually the Connect / Disconnect button. */
    action?: ReactNode;
    /** Extra pills next to the status (e.g. Test / Live). */
    extra?: ReactNode;
}

/** Status = icon + word + colour: "Connected" (green tick) or "Not connected". */
export function ConnectionRow({ connected, name, icon, detail, action, extra }: ConnectionRowProps) {
    return (
        <div
            className={cn(
                'flex flex-col gap-4 rounded-control border p-4 sm:flex-row sm:items-center sm:justify-between',
                connected ? 'border-success/30 bg-success-soft/50' : 'border-border bg-surface-2',
            )}
        >
            <div className="flex min-w-0 items-start gap-3">
                <div
                    className={cn(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-control [&_svg]:h-5 [&_svg]:w-5',
                        connected ? 'bg-surface text-success-fg' : 'bg-surface text-muted',
                    )}
                    aria-hidden
                >
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-text">{name}</p>
                        <StatusPill
                            size="sm"
                            status={connected ? 'connected' : 'inactive'}
                            label={connected ? 'Connected' : 'Not connected'}
                        />
                        {extra}
                    </div>
                    {detail && <div className="mt-1 break-words text-[14px] text-muted">{detail}</div>}
                </div>
            </div>
            {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
        </div>
    );
}

interface CopyFieldProps {
    label: string;
    value: string;
    /** Toast after copying, e.g. "Webhook link copied". */
    copiedMessage?: string;
    hint?: ReactNode;
}

/** A read-only value (webhook URL, key) with a Copy button. Wraps on phones. */
export function CopyField({ label, value, copiedMessage = 'Copied', hint }: CopyFieldProps) {
    const copy = () => {
        navigator.clipboard.writeText(value)
            .then(() => notify.success(copiedMessage))
            .catch(() => notify.error('Could not copy. Select it and copy it yourself.'));
    };
    return (
        <div className="space-y-2 rounded-control border border-border p-4">
            <p className="text-small font-medium text-text">{label}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-control bg-surface-2 px-3 py-2.5 font-mono text-[13px] text-text">
                    {value}
                </code>
                <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
                    <Copy className="h-4 w-4" aria-hidden /> Copy
                </Button>
            </div>
            {hint && <p className="text-[14px] leading-relaxed text-muted">{hint}</p>}
        </div>
    );
}

interface SegmentedProps<T extends string> {
    label: string;
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (next: T) => void;
    disabled?: boolean;
}

/** Two or three choices as a radio group (keeps role="radio" semantics). */
export function Segmented<T extends string>({ label, options, value, onChange, disabled }: SegmentedProps<T>) {
    return (
        <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-control border border-border bg-surface-2 p-1">
            {options.map((o) => {
                const active = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={disabled}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            'min-h-[40px] min-w-[88px] rounded-[10px] px-4 text-[15px] font-semibold transition-colors duration-ui disabled:opacity-50',
                            active ? 'bg-surface text-text shadow-soft' : 'text-muted hover:text-text',
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
