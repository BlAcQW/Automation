'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, MailWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
    AuthFrame,
    AUTH_ERROR_RED,
    authHeading,
    authPrimaryBtnInline,
    authSub,
} from '@/components/auth/auth-frame';

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
        <AuthFrame>
            {status === 'ok' && (
                <>
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-[5px] bg-forest-night text-forest-glow">
                        <CheckCircle2 className="h-5 w-5" aria-hidden />
                    </div>
                    <h1 className={`mt-6 ${authHeading}`}>Email confirmed.</h1>
                    <p className={`mt-4 ${authSub} max-w-[42ch]`}>
                        Thanks. We can now reach you about your bookings and your account.
                    </p>
                    <div className="mt-8">
                        <Link href={isAuthenticated ? '/dashboard' : '/login'} className={authPrimaryBtnInline}>
                            {isAuthenticated ? 'Back to dashboard' : 'Sign in'}
                        </Link>
                    </div>
                </>
            )}

            {status === 'invalid' && (
                <>
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-[5px] bg-[#E0A43A]/15 text-[#8A5A12]">
                        <MailWarning className="h-5 w-5" aria-hidden />
                    </div>
                    <h1 className={`mt-6 ${authHeading}`}>This link has expired.</h1>
                    <p className={`mt-4 ${authSub} max-w-[42ch]`}>
                        Confirmation links work for 7 days. Ask for a new one and use it straight away.
                    </p>
                    <div className="mt-8 flex flex-col sm:flex-row gap-3">
                        {isAuthenticated ? (
                            <button
                                type="button"
                                onClick={resend}
                                disabled={resent === 'sending' || resent === 'sent'}
                                className={authPrimaryBtnInline}
                            >
                                {resent === 'sent' ? 'Sent, check your inbox' : resent === 'sending' ? 'Sending…' : 'Send a new link'}
                            </button>
                        ) : (
                            <Link href="/login" className={authPrimaryBtnInline}>Sign in to resend</Link>
                        )}
                    </div>
                    {resent === 'failed' && (
                        <p className="mt-3 text-[13px]" style={{ color: AUTH_ERROR_RED }}>
                            We could not send it right now. Try again in a few minutes.
                        </p>
                    )}
                </>
            )}
        </AuthFrame>
    );
}
