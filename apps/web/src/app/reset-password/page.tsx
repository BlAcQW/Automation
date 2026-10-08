'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { Input } from '@bookingflow/ui';
import {
    AuthFrame,
    authErrorBox,
    authFormClass,
    authHeading,
    authInputClass,
    authInputErrorClass,
    authPrimaryBtn,
    authPrimaryBtnInline,
    authSub,
} from '@/components/auth/auth-frame';

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
        <AuthFrame>
            {!token ? (
                <Expired />
            ) : done ? (
                <div>
                    <h1 className={`${authHeading} mb-4`}>Password updated.</h1>
                    <p className={`${authSub} max-w-[42ch]`}>
                        You can sign in with your new password now.
                    </p>
                    <div className="mt-8">
                        <Link href="/login" className={authPrimaryBtnInline}>
                            Sign in <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            ) : (
                <>
                    <h1 className={`${authHeading} mb-3`}>Choose a new password.</h1>
                    <p className={`${authSub} mb-8`}>At least 8 characters.</p>

                    {error && (
                        <div role="alert" className={`${authErrorBox} mb-5`}>
                            {error}{' '}
                            <Link href="/forgot-password" className="underline underline-offset-2 font-medium">
                                Request a new link
                            </Link>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className={authFormClass}>
                        <Input
                            type="password"
                            label="New password"
                            icon={<Lock className="w-[18px] h-[18px]" />}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="new-password"
                            minLength={8}
                            className={authInputClass}
                            required
                        />
                        <Input
                            type="password"
                            label="Type it again"
                            icon={<Lock className="w-[18px] h-[18px]" />}
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="new-password"
                            minLength={8}
                            error={mismatch ? 'These do not match.' : undefined}
                            className={mismatch ? `${authInputClass} ${authInputErrorClass}` : authInputClass}
                            required
                        />
                        <button
                            type="submit"
                            disabled={isLoading || password.length < 8 || password !== confirm}
                            className={authPrimaryBtn}
                        >
                            {isLoading ? 'Saving…' : (<>Save new password <ArrowRight className="w-4 h-4" /></>)}
                        </button>
                    </form>
                </>
            )}
        </AuthFrame>
    );
}

function Expired() {
    return (
        <div>
            <h1 className={`${authHeading} mb-4`}>This link is not valid.</h1>
            <p className={`${authSub} max-w-[42ch]`}>
                Reset links work for one hour and only once. Ask for a fresh one and use it straight away.
            </p>
            <div className="mt-8">
                <Link href="/forgot-password" className={authPrimaryBtnInline}>
                    Request a new link
                </Link>
            </div>
        </div>
    );
}
