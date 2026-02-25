'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion } from 'framer-motion';
import { MessageSquare, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
        <div className="min-h-screen bg-[#060b18] bg-grid flex items-center justify-center px-4 relative overflow-hidden">
            {/* Background orbs */}
            <div className="bg-orb bg-orb-1" />
            <div className="bg-orb bg-orb-2" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md relative z-10"
            >
                {/* Logo */}
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center space-x-2.5">
                        <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-glow-sm">
                            <MessageSquare className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-bold text-white tracking-tight">BookingFlow</span>
                    </Link>
                </div>

                {/* Card */}
                <div className="glass-card rounded-2xl p-8">
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
                        <p className="text-slate-400">Sign in to your account</p>
                    </div>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl mb-6 text-sm"
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

                        <Button
                            type="submit"
                            isLoading={isLoading}
                            className="w-full"
                            size="lg"
                        >
                            Sign In <ArrowRight className="w-5 h-5" />
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <p className="text-slate-400">
                            Don&apos;t have an account?{' '}
                            <Link href="/register" className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
                                Sign up
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Admin Link */}
                <div className="mt-6 text-center">
                    <Link
                        href="/admin/login"
                        className="text-slate-600 hover:text-slate-400 text-sm transition-colors"
                    >
                        Platform Admin Login →
                    </Link>
                </div>
            </motion.div>
        </div>
    );
}
