'use client';

import { useState } from 'react';
import { Eye, Loader2, ShieldCheck } from 'lucide-react';
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
            <span className={`inline-flex items-center gap-1.5 ${className}`}>
                <span className="tabular-nums">{revealed ?? value}</span>
                {revealed && (
                    <span
                        title="This reveal was recorded in your activity log"
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-400"
                    >
                        <ShieldCheck className="w-3 h-3" />
                        logged
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
                    ? 'Too many reveals this hour'
                    : 'Could not reveal',
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
            <span className="tabular-nums tracking-tight">{value}</span>
            <button
                type="button"
                onClick={reveal}
                disabled={loading}
                title="Show the full number — this will be recorded"
                aria-label="Show full contact details"
                className="inline-flex items-center justify-center w-5 h-5 rounded-sm text-ink-400 hover:text-forest-brand hover:bg-bookly-emerald-100 dark:hover:bg-white/[0.06] dark:hover:text-forest-glow transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] disabled:opacity-50"
            >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            {failed && <span className="text-[10px] text-[#B03A2E] dark:text-[#F0B8B0]">{failed}</span>}
        </span>
    );
}
