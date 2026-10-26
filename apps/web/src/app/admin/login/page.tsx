'use client';

import { useState } from 'react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import { ArrowLeft, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button, Input } from '@bookingflow/ui';
import { AuthAlert, AuthFrame, AuthTitle, authMutedLink } from '@/components/auth/auth-frame';
import { useInlineValidation } from '@/components/auth/use-inline-validation';

export default function AdminLoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    // Second factor: shown once the API says this admin has 2FA on.
    const [code, setCode] = useState('');
    const [needCode, setNeedCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { field } = useInlineValidation();
    const emailField = field('email', {
        missing: 'Please enter your email.',
        format: "That email doesn't look right. Check for a missing @ or dot.",
    });
    const passwordField = field('password', { missing: 'Please enter your password.' });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // `_retry` makes the client's 401 handler skip its refresh attempt: a 401 from
            // login is an answer (bad password / "2FA code needed"), not an expired session,
            // and the refresh failure would otherwise replace that answer.
            const response = await adminApi.post(
                '/admin/auth/login',
                { email, password, ...(needCode && code.trim() ? { code: code.trim() } : {}) },
                { _retry: true } as never,
            );
            localStorage.setItem('adminAccessToken', response.data.accessToken);
            const isProd = process.env.NODE_ENV === 'production';
            document.cookie = `adminAccessToken=${encodeURIComponent(response.data.accessToken)}; path=/; max-age=900; samesite=lax${isProd ? '; secure' : ''}`;
            // Full navigation, not router.push: the admin layout only loads the session on
            // mount, so a client-side push landed on /admin with no admin in state and
            // bounced straight back here.
            // If the platform requires 2FA and this admin has none, the account page is
            // the only place the API will let them go.
            const tf = response.data.twoFactor;
            window.location.assign(tf?.required && !tf?.enrolled ? '/admin/account' : '/admin');
        } catch (err: any) {
            if (err.response?.data?.totpRequired) {
                setNeedCode(true);
                setError('');
            } else {
                setError(err.response?.data?.message || 'Invalid email or password');
                if (needCode && err.response?.status !== 429) setCode('');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthFrame
            statement={
                <>
                    Platform admin.{' '}
                    <span className="text-cream/70">Every action here is recorded in the audit log.</span>
                </>
            }
            proof={null}
        >
            <div
                className="mb-6 flex h-14 w-14 items-center justify-center rounded-card bg-primary-soft text-primary"
                aria-hidden
            >
                <ShieldCheck className="h-7 w-7" />
            </div>
            <AuthTitle sub="For the Bookly team only. Log in with your admin account.">Admin log in</AuthTitle>

            {error && (
                <AuthAlert>
                    {error.replace(/\.\s*$/, '')}. Check your details and try again.
                </AuthAlert>
            )}

            {needCode && !error && (
                <AuthAlert tone="notice">One more step: enter the code from your authenticator app.</AuthAlert>
            )}

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
                    placeholder="name@company.com"
                    autoComplete="username"
                    inputMode="email"
                    required
                    {...emailField.props}
                />
                <Input
                    type="password"
                    label="Password"
                    icon={<Lock />}
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        passwordField.recheck(e.target);
                    }}
                    placeholder="Your password"
                    autoComplete="current-password"
                    required
                    {...passwordField.props}
                />
                {needCode && (
                    <Input
                        id="admin-2fa-code"
                        label="Two-factor code"
                        icon={<KeyRound />}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="tracking-widest"
                        placeholder="123456 or a recovery code"
                        autoComplete="one-time-code"
                        inputMode="text"
                        hint="From your authenticator app. Lost your phone? Use one of your recovery codes."
                        autoFocus
                        required
                    />
                )}
                <Button type="submit" size="lg" fullWidth isLoading={loading} loadingText="Logging you in…">
                    Log in
                </Button>
            </form>

            <p className="mt-6 text-center">
                <Link href="/login" className={authMutedLink}>
                    <ArrowLeft className="h-4 w-4" aria-hidden /> Back to business log in
                </Link>
            </p>
        </AuthFrame>
    );
}
