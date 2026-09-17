'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';
import { GlowButton } from '@/components/primitives/glow-button';
import { Input } from '@/components/ui/input';

/** Landing page for the link in the reset email. */
export default function ResetPasswordPage() {
    // useSearchParams needs a Suspense boundary for static prerendering.
    return (
        <Suspense fallback={null}>
            <ResetPasswordForm />
        </Suspense>
    );
}

function ResetPasswordForm() {
    const token = useSearchParams().get('token') ?? '';
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const mismatch = confirm.length > 0 && password !== confirm;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) return;
        setError('');
        setIsLoading(true);
        try {
            await api.post('/auth/reset-password', { token, password });
            setDone(true);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'This reset link is invalid or has expired. Request a new one.');
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

                {!token ? (
                    <Expired />
                ) : done ? (
                    <div>
                        <h1 className="font-display text-display-md text-ink-50 mb-3 tracking-tight">
                            Password updated
                        </h1>
                        <p className="text-body text-ink-300 max-w-[42ch]">
                            You can sign in with your new password now.
                        </p>
                        <div className="mt-8">
                            <GlowButton href="/login" size="lg">
                                Sign in <ArrowRight className="w-4 h-4" />
                            </GlowButton>
                        </div>
                    </div>
                ) : (
                    <>
                        <h1 className="font-display text-display-md text-ink-50 mb-2 tracking-tight">
                            Choose a new password
                        </h1>
                        <p className="text-body text-ink-300 mb-8">At least 8 characters.</p>

                        {error && (
                            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl mb-6 text-body-sm">
                                {error}{' '}
                                <Link href="/forgot-password" className="underline underline-offset-2 text-rose-200">
                                    Request a new link
                                </Link>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <Input
                                type="password"
                                label="New password"
                                icon={<Lock className="w-5 h-5" />}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="new-password"
                                minLength={8}
                                required
                            />
                            <Input
                                type="password"
                                label="Type it again"
                                icon={<Lock className="w-5 h-5" />}
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                placeholder="••••••••"
                                autoComplete="new-password"
                                minLength={8}
                                error={mismatch ? 'These do not match.' : undefined}
                                required
                            />
                            <GlowButton
                                type="submit"
                                disabled={isLoading || password.length < 8 || password !== confirm}
                                className="w-full"
                                size="lg"
                            >
                                {isLoading ? 'Saving…' : (<>Save new password <ArrowRight className="w-4 h-4" /></>)}
                            </GlowButton>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}

function Expired() {
    return (
        <div>
            <h1 className="font-display text-display-md text-ink-50 mb-3 tracking-tight">
                This link is not valid
            </h1>
            <p className="text-body text-ink-300 max-w-[42ch]">
                Reset links work for one hour and only once. Ask for a fresh one and use it straight away.
            </p>
            <div className="mt-8">
                <GlowButton href="/forgot-password" size="lg">
                    Request a new link
                </GlowButton>
            </div>
        </div>
    );
}
