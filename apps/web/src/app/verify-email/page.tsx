'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, MailWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, TickPop } from '@bookingflow/ui';
import { AuthFrame, AuthTitle } from '@/components/auth/auth-frame';

const primaryLink =
    'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover';

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
                    <TickPop size={64} label="Email confirmed" className="mb-6" />
                    <AuthTitle sub="Thanks! We can now reach you about your bookings and your account.">
                        Email confirmed
                    </AuthTitle>
                    <Link href={isAuthenticated ? '/dashboard' : '/login'} className={primaryLink}>
                        {isAuthenticated ? 'Go to my dashboard' : 'Log in'}
                    </Link>
                </>
            )}

            {status === 'invalid' && (
                <>
                    <div
                        className="mb-6 flex h-14 w-14 items-center justify-center rounded-card bg-warning-soft text-warning-fg"
                        aria-hidden
                    >
                        <MailWarning className="h-7 w-7" />
                    </div>
                    <AuthTitle sub="Confirmation links work for 7 days. Ask for a new one and use it straight away.">
                        This link has expired
                    </AuthTitle>
                    {isAuthenticated ? (
                        <Button
                            type="button"
                            size="lg"
                            onClick={resend}
                            isLoading={resent === 'sending'}
                            loadingText="Sending…"
                            disabled={resent === 'sent'}
                        >
                            {resent === 'sent' ? 'Sent! Check your inbox' : 'Send me a new link'}
                        </Button>
                    ) : (
                        <Link href="/login" className={primaryLink}>
                            Log in to get a new link
                        </Link>
                    )}
                    {resent === 'failed' && (
                        <p role="alert" className="mt-4 flex items-start gap-1.5 text-[15px] font-medium text-error-fg">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            Oops, that didn&apos;t work. Wait a few minutes, then tap the button again.
                        </p>
                    )}
                </>
            )}
        </AuthFrame>
    );
}
