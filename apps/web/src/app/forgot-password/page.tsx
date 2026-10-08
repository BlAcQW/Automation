'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowRight, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@bookingflow/ui';
import {
    AuthFrame,
    authErrorBox,
    authFormClass,
    authGhostBtn,
    authHeading,
    authInputClass,
    authMutedLink,
    authPrimaryBtn,
    authPrimaryBtnInline,
    authSub,
} from '@/components/auth/auth-frame';

/**
 * Forgot password. One field, one button. The confirmation is worded the
 * same whether or not the address exists, matching the API.
 */
export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

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
                    <span className="text-forest-cream/50">Your bookings keep coming in while you sort it out.</span>
                </>
            }
        >
            {sent ? (
                <div>
                    <h1 className={`${authHeading} mb-4`}>Check your email.</h1>
                    <p className={`${authSub} max-w-[42ch]`}>
                        If there is a Bookly account for <span className="text-forest-ink font-medium">{email.trim()}</span>, we
                        have sent it a link to choose a new password. The link works for one hour.
                    </p>
                    <p className="mt-4 text-[13px] text-[#5F675E]">
                        Nothing there after a minute? Look in the spam folder, or try again with the email you signed up with.
                    </p>
                    <div className="mt-8 flex flex-col sm:flex-row gap-2">
                        <Link href="/login" className={authPrimaryBtnInline}>
                            Back to sign in
                        </Link>
                        <button
                            type="button"
                            onClick={() => setSent(false)}
                            className={authGhostBtn}
                        >
                            Use a different email
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <h1 className={`${authHeading} mb-3`}>Forgot your password?</h1>
                    <p className={`${authSub} mb-8 max-w-[42ch]`}>
                        Type the email you signed up with and we will send you a link to choose a new one.
                    </p>

                    {error && (
                        <div role="alert" className={`${authErrorBox} mb-5`}>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className={authFormClass}>
                        <Input
                            type="email"
                            label="Email"
                            icon={<Mail className="w-[18px] h-[18px]" />}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            className={authInputClass}
                            required
                        />
                        <button type="submit" disabled={isLoading || !email.trim()} className={authPrimaryBtn}>
                            {isLoading ? 'Sending…' : (<>Send reset link <ArrowRight className="w-4 h-4" /></>)}
                        </button>
                    </form>

                    <p className="mt-8">
                        <Link href="/login" className={`${authMutedLink} inline-flex items-center gap-1.5 min-h-[44px]`}>
                            <ArrowLeft className="w-4 h-4" /> Back to sign in
                        </Link>
                    </p>
                </>
            )}
        </AuthFrame>
    );
}
