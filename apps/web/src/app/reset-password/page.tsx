'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock, ArrowRight, LinkIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Input, TickPop } from '@bookingflow/ui';
import { AuthAlert, AuthFrame, AuthTitle, authLink } from '@/components/auth/auth-frame';
import { useInlineValidation } from '@/components/auth/use-inline-validation';

const primaryLink =
    'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover';

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
    const { field } = useInlineValidation();
    const passwordField = field('password', {
        missing: 'Please choose a new password.',
        short: 'Use at least 8 characters.',
    });

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
        <AuthFrame>
            {!token ? (
                <Expired />
            ) : done ? (
                <div>
                    <TickPop size={64} label="Password updated" className="mb-6" />
                    <AuthTitle sub="All set. You can log in with your new password now.">Password updated</AuthTitle>
                    <Link href="/login" className={primaryLink}>
                        Log in <ArrowRight className="h-5 w-5" aria-hidden />
                    </Link>
                </div>
            ) : (
                <>
                    <AuthTitle sub="Pick something you'll remember. At least 8 characters.">Choose a new password</AuthTitle>

                    {error && (
                        <AuthAlert>
                            {error}{' '}
                            <Link href="/forgot-password" className={authLink}>
                                Request a new link
                            </Link>
                        </AuthAlert>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <Input
                            type="password"
                            label="New password"
                            icon={<Lock />}
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                passwordField.recheck(e.target);
                            }}
                            placeholder="At least 8 characters"
                            autoComplete="new-password"
                            minLength={8}
                            required
                            {...passwordField.props}
                        />
                        <Input
                            type="password"
                            label="Type it again"
                            icon={<Lock />}
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="Same password again"
                            autoComplete="new-password"
                            minLength={8}
                            error={mismatch ? "These don't match yet. Check both boxes." : undefined}
                            required
                        />
                        <Button
                            type="submit"
                            size="lg"
                            fullWidth
                            isLoading={isLoading}
                            loadingText="Saving…"
                            disabled={password.length < 8 || password !== confirm}
                        >
                            Save new password <ArrowRight className="h-5 w-5" aria-hidden />
                        </Button>
                    </form>
                </>
            )}
        </AuthFrame>
    );
}

function Expired() {
    return (
        <div>
            <div
                className="mb-6 flex h-14 w-14 items-center justify-center rounded-card bg-warning-soft text-warning-fg"
                aria-hidden
            >
                <LinkIcon className="h-7 w-7" />
            </div>
            <AuthTitle sub="Reset links work for one hour and only once. Ask for a fresh one and use it straight away.">
                This link has expired
            </AuthTitle>
            <Link href="/forgot-password" className={primaryLink}>
                Send me a new link
            </Link>
        </div>
    );
}
