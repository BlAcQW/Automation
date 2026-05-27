'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';
import { GlowButton } from '@/components/primitives/glow-button';
import { Input } from '@/components/ui/input';

/**
 * Login — ui.md split layout. Form left, atmospheric Bookly glow right.
 * Single column below `lg`.
 */
export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            await login(email, password);
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Invalid email or password');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen grid lg:grid-cols-2 bg-ink-950 text-ink-50 relative overflow-hidden">
            {/* Form column */}
            <div className="flex items-center justify-center px-4 sm:px-8 py-12 relative">
                {/* Mobile-only background atmosphere */}
                <div className="lg:hidden absolute inset-0 pointer-events-none">
                    <div className="bg-orb bg-orb-1" />
                    <div className="bg-orb bg-orb-2" />
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full max-w-md relative z-10"
                >
                    <div className="mb-10">
                        <Link href="/" className="inline-block">
                            <BooklyWordmark size="lg" />
                        </Link>
                    </div>

                    <h1 className="font-display text-display-md text-ink-50 mb-2 tracking-tight">
                        Welcome back
                    </h1>
                    <p className="text-body text-ink-300 mb-8">Sign in to your Bookly account.</p>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl mb-6 text-body-sm"
                        >
                            {error}
                        </motion.div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <Input
                            type="email"
                            label="Email"
                            icon={<Mail className="w-5 h-5" />}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                        />
                        <Input
                            type="password"
                            label="Password"
                            icon={<Lock className="w-5 h-5" />}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                        <GlowButton
                            type="submit"
                            disabled={isLoading}
                            className="w-full"
                            size="lg"
                        >
                            {isLoading ? 'Signing in…' : (
                                <>Sign in <ArrowRight className="w-4 h-4" /></>
                            )}
                        </GlowButton>
                    </form>

                    <p className="mt-8 text-center text-body-sm text-ink-300">
                        Don&apos;t have an account?{' '}
                        <Link href="/register" className="text-bookly-emerald-400 hover:text-bookly-emerald-300 font-medium transition-colors">
                            Start free
                        </Link>
                    </p>
                    <p className="mt-6 text-center">
                        <Link href="/admin/login" className="text-caption uppercase tracking-wider text-ink-400 hover:text-ink-200 transition-colors">
                            Platform admin →
                        </Link>
                    </p>
                </motion.div>
            </div>

            {/* Atmospheric right rail — desktop only */}
            <aside className="hidden lg:flex relative items-center justify-center bg-ink-1000 overflow-hidden border-l border-ink-700">
                <div aria-hidden className="absolute inset-0 bookly-glow opacity-90" />
                <div aria-hidden className="absolute inset-0 bg-grid opacity-40" />
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                    className="relative z-10 text-center max-w-md px-8"
                >
                    <p className="text-caption uppercase tracking-[0.18em] text-bookly-emerald-400 mb-5">
                        WhatsApp × Automation
                    </p>
                    <p className="font-display text-display-md text-ink-50 leading-tight">
                        Your business,{' '}
                        <span className="text-gradient">running itself</span>{' '}
                        on WhatsApp.
                    </p>
                    <p className="mt-6 text-body-lg text-ink-200">
                        Bookings. Payments. Reminders. All handled while you sleep.
                    </p>
                </motion.div>
            </aside>
        </div>
    );
}
