'use client';

import { useState } from 'react';
import { Eye, Loader2, ShieldCheck } from 'lucide-react';
import { cn, formatGhanaPhone } from '@bookingflow/ui';
import { api } from '@/lib/api';

interface MaskedContactProps {
    /** The value as the server sent it — already masked when it needed to be. */
    value?: string | null;
    /** Server's verdict. Never inferred from the string: the API owns this. */
    masked?: boolean;
    scope: 'conversation' | 'booking' | 'order';
    recordId: string;
    className?: string;
}

/**
 * A customer contact that staff see masked, with a one-tap reveal.
 *
 * The reveal exists because a hard block does not survive contact with a real
 * shop — people photograph the screen or ring the owner, and the owner ends up
 * switching masking off entirely. A logged, rate-limited reveal keeps the
 * workflow intact and still makes bulk copying visible.
 *
 * Saying "this was logged" out loud is deliberate. It is the part that actually
 * deters idle curiosity, and hiding it would feel like a trap once someone
 * noticed the audit trail.
 */
export function MaskedContact({ value, masked, scope, recordId, className = '' }: MaskedContactProps) {
    const [revealed, setRevealed] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);

    if (!value) return null;

    if (!masked || revealed) {
        return (
            <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
                <span className="tabular-nums">{displayContact(revealed ?? value)}</span>
                {revealed && (
                    <span
                        title="This reveal was recorded in your activity log"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted"
                    >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                        Logged
                    </span>
                )}
            </span>
        );
    }

    async function reveal() {
        setLoading(true);
        setFailed(null);
        try {
            const res = await api.post('/privacy/reveal', { scope, id: recordId });
            setRevealed(res.data.customerPhone ?? res.data.customerEmail ?? null);
        } catch (err: any) {
            setFailed(
                err?.response?.status === 429
                    ? 'Too many reveals this hour. Try again later.'
                    : "Couldn't show it. Try again.",
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
            <span className="tabular-nums tracking-tight">{value}</span>
            <button
                type="button"
                onClick={(e) => {
                    // Rows and cards around this are often clickable themselves.
                    e.stopPropagation();
                    void reveal();
                }}
                disabled={loading}
                title="Show the full number (this is recorded)"
                aria-label="Show full contact details"
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors duration-ui hover:bg-primary-soft hover:text-primary disabled:opacity-50 after:absolute after:-inset-1.5 after:content-['']"
            >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
            {failed && <span role="status" className="text-[13px] font-medium text-error-fg">{failed}</span>}
        </span>
    );
}

/** Ghana numbers read as `+233 24 412 3456`; emails and foreign numbers pass through untouched. */
function displayContact(value: string): string {
    if (value.includes('@')) return value;
    return formatGhanaPhone(value);
}
