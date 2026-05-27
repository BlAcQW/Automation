'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/api';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await adminApi.post('/admin/auth/login', { email, password });
            localStorage.setItem('adminAccessToken', response.data.accessToken);
            const isProd = process.env.NODE_ENV === 'production';
            document.cookie = `adminAccessToken=${encodeURIComponent(response.data.accessToken)}; path=/; max-age=900; samesite=lax${isProd ? '; secure' : ''}`;
            router.push('/admin');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Invalid email or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 overflow-hidden relative">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-slate-900 pointer-events-none">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl opacity-20 translate-y-1/2 -translate-x-1/2" />
            </div>

            <Card className="w-full max-w-md glass-card border-white/5 relative z-10 mx-4">
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-4">
                        <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/10">
                            <ShieldCheck className="w-6 h-6 text-emerald-400" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-white">Admin Access</h1>
                    <p className="text-slate-400">Enter your credentials to continue</p>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 text-center">
                                {error}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">Email</label>
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="bg-slate-900/50 border-slate-700 text-white placeholder:text-slate-600"
                                placeholder="name@company.com"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">Password</label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="bg-slate-900/50 border-slate-700 text-white placeholder:text-slate-600"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                        <Button
                            type="submit"
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                'Sign In'
                            )}
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <Link href="/login" className="text-slate-500 hover:text-slate-400 text-sm transition-colors">
                            ← Back to User Login
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
