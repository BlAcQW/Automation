'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import { Input } from '@bookingflow/ui';
import {
    AuthFrame,
    authErrorBox,
    authFormClass,
    authHeading,
    authInputClass,
    authLink,
    authMutedLink,
    authNoticeBox,
    authPrimaryBtn,
    authSub,
} from '@/components/auth/auth-frame';

/**
 * Login — forest-frame split: paper form panel left, night satin right.
 * Paper panel only below `lg`.
 */
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

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('reason') === 'expired') {
            setNotice('You were signed out after a while away. Sign in to carry on.');
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
                    <span className="text-forest-cream/50">your customers still got an answer.</span>
                </>
            }
        >
            <h1 className={`${authHeading} mb-3`}>Welcome back.</h1>
            <p className={`${authSub} mb-8`}>Sign in to your Bookly account.</p>

            {notice && !error && (
                <div role="status" className={`${authNoticeBox} mb-5`}>
                    {notice}
                </div>
            )}

            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`${authErrorBox} mb-5`}
                >
                    {error}
                </motion.div>
            )}

            <form onSubmit={handleSubmit} className={authFormClass}>
                <Input
                    type="email"
                    label="Email"
                    icon={<Mail className="w-[18px] h-[18px]" />}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={authInputClass}
                    required
                />
                <Input
                    type="password"
                    label="Password"
                    icon={<Lock className="w-[18px] h-[18px]" />}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className={authInputClass}
                    required
                />
                <div className="flex justify-end -mt-1">
                    <Link href="/forgot-password" className={`${authMutedLink} py-1`}>
                        Forgot your password?
                    </Link>
                </div>
                <button type="submit" disabled={isLoading} className={authPrimaryBtn}>
                    {isLoading ? 'Signing in…' : (
                        <>Sign in <ArrowRight className="w-4 h-4" /></>
                    )}
                </button>
            </form>

            <p className="mt-8 text-center text-[13px] text-[#5F675E]">
                Don&apos;t have an account?{' '}
                <Link href="/register" className={authLink}>
                    Start free
                </Link>
            </p>
        </AuthFrame>
    );
}
