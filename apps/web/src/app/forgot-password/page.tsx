'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowRight, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';
import { GlowButton } from '@/components/primitives/glow-button';
import { Input } from '@/components/ui/input';

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
        <div className="min-h-screen bg-ink-950 text-ink-50 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                <div className="mb-10">
                    <Link href="/" className="inline-block">
                        <BooklyWordmark size="lg" />
                    </Link>
                </div>

                {sent ? (
                    <div>
                        <h1 className="font-display text-display-md text-ink-50 mb-3 tracking-tight">
                            Check your email
                        </h1>
                        <p className="text-body text-ink-300 max-w-[42ch]">
                            If there is a Bookly account for <span className="text-ink-50">{email.trim()}</span>, we
                            have sent it a link to choose a new password. The link works for one hour.
                        </p>
                        <p className="mt-4 text-body-sm text-ink-300">
                            Nothing there after a minute? Look in the spam folder, or try again with the email you signed up with.
                        </p>
                        <div className="mt-8 flex flex-col sm:flex-row gap-3">
                            <GlowButton href="/login" size="md">
                                Back to sign in
                            </GlowButton>
                            <button
                                type="button"
                                onClick={() => setSent(false)}
                                className="h-12 px-6 rounded-xl border border-ink-700 text-[15px] font-medium text-ink-50 hover:border-ink-600 hover:bg-ink-900/60 transition-colors"
                            >
                                Use a different email
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <h1 className="font-display text-display-md text-ink-50 mb-2 tracking-tight">
                            Forgot your password?
                        </h1>
                        <p className="text-body text-ink-300 mb-8 max-w-[42ch]">
                            Type the email you signed up with and we will send you a link to choose a new one.
                        </p>

                        {error && (
                            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl mb-6 text-body-sm">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <Input
                                type="email"
                                label="Email"
                                icon={<Mail className="w-5 h-5" />}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                autoComplete="email"
                                required
                            />
                            <GlowButton type="submit" disabled={isLoading || !email.trim()} className="w-full" size="lg">
                                {isLoading ? 'Sending…' : (<>Send reset link <ArrowRight className="w-4 h-4" /></>)}
                            </GlowButton>
                        </form>

                        <p className="mt-8">
                            <Link href="/login" className="inline-flex items-center gap-1.5 text-body-sm text-ink-300 hover:text-ink-50 transition-colors">
                                <ArrowLeft className="w-4 h-4" /> Back to sign in
                            </Link>
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
