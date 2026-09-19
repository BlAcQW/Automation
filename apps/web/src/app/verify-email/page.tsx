'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, MailWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';
import { GlowButton } from '@/components/primitives/glow-button';

/** Where the link in the confirmation email lands, via the API redirect. */
export default function VerifyEmailPage() {
    const { isAuthenticated, refreshUser } = useAuth();
    const [status, setStatus] = useState<'ok' | 'invalid' | null>(null);
    const [resent, setResent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

    useEffect(() => {
        // Read the query without useSearchParams so the page can prerender.
        const s = new URLSearchParams(window.location.search).get('status');
        setStatus(s === 'ok' ? 'ok' : 'invalid');
    }, []);

    useEffect(() => {
        if (status === 'ok' && isAuthenticated) refreshUser().catch(() => undefined);
    }, [status, isAuthenticated, refreshUser]);

    const resend = async () => {
        setResent('sending');
        try {
            await api.post('/auth/resend-verification');
            setResent('sent');
        } catch {
            setResent('failed');
        }
    };

    return (
        <main id="main" className="min-h-screen bg-ink-950 text-ink-50 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <Link href="/" className="inline-block">
                    <BooklyWordmark size="lg" />
                </Link>

                {status === 'ok' && (
                    <>
                        <div className="mt-10 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-bookly-emerald-500/10 text-bookly-emerald-400">
                            <CheckCircle2 className="h-6 w-6" aria-hidden />
                        </div>
                        <h1 className="mt-5 font-display text-display-md text-ink-50">Email confirmed</h1>
                        <p className="mt-3 text-body text-ink-300 max-w-[42ch]">
                            Thanks. We can now reach you about your bookings and your account.
                        </p>
                        <div className="mt-8">
                            <GlowButton href={isAuthenticated ? '/dashboard' : '/login'} size="lg">
                                {isAuthenticated ? 'Back to dashboard' : 'Sign in'}
                            </GlowButton>
                        </div>
                    </>
                )}

                {status === 'invalid' && (
                    <>
                        <div className="mt-10 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
                            <MailWarning className="h-6 w-6" aria-hidden />
                        </div>
                        <h1 className="mt-5 font-display text-display-md text-ink-50">This link has expired</h1>
                        <p className="mt-3 text-body text-ink-300 max-w-[42ch]">
                            Confirmation links work for 7 days. Ask for a new one and use it straight away.
                        </p>
                        <div className="mt-8 flex flex-col sm:flex-row gap-3">
                            {isAuthenticated ? (
                                <GlowButton size="lg" onClick={resend} disabled={resent === 'sending' || resent === 'sent'}>
                                    {resent === 'sent' ? 'Sent, check your inbox' : resent === 'sending' ? 'Sending…' : 'Send a new link'}
                                </GlowButton>
                            ) : (
                                <GlowButton href="/login" size="lg">Sign in to resend</GlowButton>
                            )}
                        </div>
                        {resent === 'failed' && (
                            <p className="mt-3 text-body-sm text-rose-300">We could not send it right now. Try again in a few minutes.</p>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
