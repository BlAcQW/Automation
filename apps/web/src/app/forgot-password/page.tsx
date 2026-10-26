'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowRight, ArrowLeft, MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input } from '@bookingflow/ui';
import { AuthAlert, AuthFrame, AuthTitle, authMutedLink } from '@/components/auth/auth-frame';
import { useInlineValidation } from '@/components/auth/use-inline-validation';

/**
 * Forgot password. One field, one button. The confirmation is worded the
 * same whether or not the address exists, matching the API.
 */
export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { field } = useInlineValidation();
    const emailField = field('email', {
        missing: 'Please enter your email.',
        format: "That email doesn't look right. Check for a missing @ or dot.",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            await api.post('/auth/forgot-password', { email: email.trim() });
            setSent(true);
        } catch (err: any) {
            setError(
                err?.response?.status === 429
                    ? 'Too many attempts. Wait a few minutes and try again.'
                    : 'We could not send the email. Check your connection and try again.',
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthFrame
            statement={
                <>
                    It happens.{' '}
                    <span className="text-cream/70">Your bookings keep coming in while you sort it out.</span>
                </>
            }
        >
            {sent ? (
                <div>
                    <div
                        className="mb-6 flex h-14 w-14 items-center justify-center rounded-card bg-primary-soft text-primary"
                        aria-hidden
                    >
                        <MailCheck className="h-7 w-7" />
                    </div>
                    <AuthTitle
                        className="mb-4"
                        sub={
                            <>
                                If there is a Bookly account for{' '}
                                <span className="font-semibold text-text">{email.trim()}</span>, we&apos;ve sent it a link
                                to choose a new password. The link works for one hour.
                            </>
                        }
                    >
                        Check your email
                    </AuthTitle>
                    <p className="text-[15px] text-muted">
                        Nothing after a minute? Look in your spam folder, or try again with the email you signed up with.
                    </p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        <Link
                            href="/login"
                            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover"
                        >
                            Back to log in
                        </Link>
                        <Button type="button" variant="secondary" size="lg" onClick={() => setSent(false)}>
                            Use a different email
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <AuthTitle sub="Type the email you signed up with and we'll send you a link to choose a new one.">
                        Forgot your password?
                    </AuthTitle>

                    {error && <AuthAlert>{error}</AuthAlert>}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <Input
                            type="email"
                            label="Email"
                            icon={<Mail />}
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                emailField.recheck(e.target);
                            }}
                            placeholder="you@example.com"
                            autoComplete="email"
                            inputMode="email"
                            required
                            {...emailField.props}
                        />
                        <Button
                            type="submit"
                            size="lg"
                            fullWidth
                            isLoading={isLoading}
                            loadingText="Sending…"
                            disabled={!email.trim()}
                        >
                            Send me a reset link <ArrowRight className="h-5 w-5" aria-hidden />
                        </Button>
                    </form>

                    <p className="mt-6">
                        <Link href="/login" className={authMutedLink}>
                            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to log in
                        </Link>
                    </p>
                </>
            )}
        </AuthFrame>
    );
}
