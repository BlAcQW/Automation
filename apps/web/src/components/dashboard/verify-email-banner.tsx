'use client';

import { useState } from 'react';
import { MailCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const HIDE_KEY = 'bf-verify-banner-hidden';

/**
 * Sits at the top of the Overview until the address is confirmed. Nothing is
 * blocked on it; the point is to catch a mistyped email while the person is
 * still around to fix it, before a password reset ever needs to reach them.
 */
export function VerifyEmailBanner() {
    const { user } = useAuth();
    const [hidden, setHidden] = useState(() => {
        try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
    });
    const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

    if (!user || user.emailVerifiedAt || hidden) return null;

    const resend = async () => {
        setState('sending');
        try {
            await api.post('/auth/resend-verification');
            setState('sent');
        } catch {
            setState('failed');
        }
    };

    const dismiss = () => {
        try { sessionStorage.setItem(HIDE_KEY, '1'); } catch { /* private mode */ }
        setHidden(true);
    };

    return (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
            <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-ink-50">
                    Confirm your email: <span className="text-ink-200">{user.email}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-ink-300">
                    We sent you a link. If this address is wrong, change it in Settings before anything important is sent there.
                </p>
                <div className="mt-2">
                    {state === 'sent' ? (
                        <span className="text-[13px] text-bookly-emerald-400">Sent. Check your inbox and spam folder.</span>
                    ) : (
                        <button
                            type="button"
                            onClick={resend}
                            disabled={state === 'sending'}
                            className="text-[13px] font-medium text-bookly-emerald-400 hover:text-bookly-emerald-300 underline underline-offset-2 disabled:opacity-60"
                        >
                            {state === 'sending' ? 'Sending…' : state === 'failed' ? 'Could not send. Try again' : 'Resend the link'}
                        </button>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Hide for now"
                className="shrink-0 rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-50 transition-colors"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
