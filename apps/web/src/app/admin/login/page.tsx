'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/api';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Input } from '@bookingflow/ui';
import {
    AuthFrame,
    authErrorBox,
    authFormClass,
    authHeading,
    authInputClass,
    authMutedLink,
    authPrimaryBtn,
    authSub,
} from '@/components/auth/auth-frame';

const LABEL = 'block text-[12px] font-medium text-forest-ink';

export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    // Second factor: shown once the API says this admin has 2FA on.
    const [code, setCode] = useState('');
    const [needCode, setNeedCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
                    <span className="text-forest-cream/50">Every action here is recorded in the audit log.</span>
                </>
            }
            proof={null}
        >
            <div className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-[5px] bg-forest-night text-forest-glow">
                <ShieldCheck className="w-5 h-5" />
            </div>
            <h1 className={`${authHeading} mb-3`}>Admin access.</h1>
            <p className={`${authSub} mb-8`}>Enter your credentials to continue</p>

            <form onSubmit={handleSubmit} className={authFormClass}>
                {error && (
                    <div className={authErrorBox}>
                        {error}
                    </div>
                )}
                <div className="space-y-1.5">
                    <label className={LABEL}>Email</label>
                    <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={authInputClass}
                        placeholder="name@company.com"
                        required
                    />
                </div>
                <div className="space-y-1.5">
                    <label className={LABEL}>Password</label>
                    <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={authInputClass}
                        placeholder="••••••••"
                        required
                    />
                </div>
                {needCode && (
                    <div className="space-y-1.5">
                        <label className={LABEL} htmlFor="admin-2fa-code">Two-factor code</label>
                        <Input
                            id="admin-2fa-code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className={`${authInputClass} tracking-widest`}
                            placeholder="123456 or a recovery code"
                            autoComplete="one-time-code"
                            inputMode="text"
                            autoFocus
                            required
                        />
                        <p className="text-[12px] text-[#5F675E]">From your authenticator app. Lost your device? Use one of your recovery codes.</p>
                    </div>
                )}
                <button
                    type="submit"
                    className={authPrimaryBtn}
                    disabled={loading}
                >
                    {loading ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Signing in...
                        </>
                    ) : (
                        'Sign In'
                    )}
                </button>
            </form>

            <div className="mt-6 text-center">
                <Link href="/login" className={`${authMutedLink} inline-flex items-center min-h-[44px]`}>
                    ← Back to User Login
                </Link>
            </div>
        </AuthFrame>
    );
}
