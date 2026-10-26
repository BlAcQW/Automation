'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, MailCheck, X } from 'lucide-react';
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
        <div role="status" className="flex items-start gap-3 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 sm:px-5">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning-fg" aria-hidden />
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-text">
                    Please confirm your email: <span className="break-all font-medium">{user.email}</span>
                </p>
                <p className="mt-0.5 text-[15px] text-muted">
                    We sent you a link. If this email is wrong, change it in Settings so you don&apos;t miss anything important.
                </p>
                <div className="mt-1">
                    {state === 'sent' ? (
                        <span className="inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-success-fg">
                            <CheckCircle2 className="h-4 w-4" aria-hidden />
                            Sent! Check your inbox and spam folder.
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={resend}
                            disabled={state === 'sending'}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control text-[15px] font-semibold text-primary underline underline-offset-4 hover:text-primary-hover disabled:opacity-60"
                        >
                            {state === 'failed' && <AlertCircle className="h-4 w-4 text-error-fg" aria-hidden />}
                            {state === 'sending'
                                ? 'Sending…'
                                : state === 'failed'
                                  ? "That didn't send. Try again"
                                  : 'Send the link again'}
                        </button>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Hide for now"
                className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-ui hover:bg-text/[0.06] hover:text-text"
            >
                <X className="h-5 w-5" />
            </button>
        </div>
    );
}
