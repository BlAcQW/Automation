'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import { Button, Input } from '@bookingflow/ui';
import { AuthAlert, AuthFootnote, AuthFrame, AuthTitle, authLink, authMutedLink } from '@/components/auth/auth-frame';
import { useInlineValidation } from '@/components/auth/use-inline-validation';
import { SIGNUP_CTA } from '@/lib/signup-cta';

/** Log in. Cream form on the left; on large screens a green panel on the right. */
export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // Why they are here and where to send them after. Read from the URL in an
    // effect (not useSearchParams) so the page still prerenders.
    const [notice, setNotice] = useState('');
    const [nextPath, setNextPath] = useState('/dashboard');
    const { field } = useInlineValidation();
    const emailField = field('email', {
        missing: 'Please enter your email.',
        format: "That email doesn't look right. Check for a missing @ or dot.",
    });
    const passwordField = field('password', { missing: 'Please enter your password.' });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('reason') === 'expired') {
            setNotice('You were signed out after a while away. Log in again to carry on.');
        }
        const next = params.get('next');
        // Only same-site paths: never bounce someone to another domain.
        if (next && next.startsWith('/') && !next.startsWith('//')) setNextPath(next);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            await login(email, password);
            router.push(nextPath);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Invalid email or password');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthFrame
            statement={
                <>
                    While you were away,{' '}
                    <span className="text-cream/70">your customers still got an answer.</span>
                </>
            }
        >
            <AuthTitle sub="Log in to see your bookings, chats and payments.">Welcome back</AuthTitle>

            {notice && !error && <AuthAlert tone="notice">{notice}</AuthAlert>}

            {error && (
                <AuthAlert>
                    {error.replace(/\.\s*$/, '')}. Check your email and password, or{' '}
                    <Link href="/forgot-password" className={authLink}>
                        reset your password
                    </Link>
                    .
                </AuthAlert>
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
                    placeholder="you@example.com"
                    autoComplete="email"
                    inputMode="email"
                    required
                    {...emailField.props}
                />
                <div>
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
                    <div className="flex justify-end">
                        <Link href="/forgot-password" className={authMutedLink}>
                            Forgot your password?
                        </Link>
                    </div>
                </div>
                <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Logging you in…">
                    Log in <ArrowRight className="h-5 w-5" aria-hidden />
                </Button>
            </form>

            <AuthFootnote>
                New to Bookly?{' '}
                <Link href={SIGNUP_CTA.href} className={authLink} data-analytics={SIGNUP_CTA.event}>
                    {SIGNUP_CTA.inline}
                </Link>
            </AuthFootnote>
        </AuthFrame>
    );
}
