'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { MessageSquare, Mail, Lock, User, Building, ArrowRight, ArrowLeft, Loader2, Package, Scissors } from 'lucide-react';

type BusinessType = 'PRODUCT' | 'SERVICE';

export default function RegisterPage() {
    const router = useRouter();
    const { register } = useAuth();
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        businessName: '',
        businessType: '' as BusinessType | '',
    });
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleBusinessType = (type: BusinessType) => {
        setFormData({ ...formData, businessType: type });
        setStep(2);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            await register({
                ...formData,
                businessType: formData.businessType as BusinessType,
            });
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center space-x-2">
                        <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center">
                            <MessageSquare className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-bold text-white">BookingFlow</span>
                    </Link>
                </div>

                {/* Card */}
                <div className="glass rounded-2xl p-8">
                    {step === 1 ? (
                        /* Step 1: Business Type Selection */
                        <>
                            <div className="text-center mb-8">
                                <h1 className="text-2xl font-bold text-white mb-2">What type of business?</h1>
                                <p className="text-gray-400">Choose how you want to sell via WhatsApp</p>
                            </div>

                            <div className="space-y-4">
                                <button
                                    onClick={() => handleBusinessType('PRODUCT')}
                                    className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-primary-500/50 rounded-2xl p-6 text-left transition-all group"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                                            <Package className="w-6 h-6 text-orange-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-white mb-1 group-hover:text-primary-400 transition-colors">
                                                Product Business
                                            </h3>
                                            <p className="text-gray-400 text-sm">
                                                Sell physical or digital products. Manage inventory, orders, and deliveries.
                                            </p>
                                        </div>
                                    </div>
                                </button>

                                <button
                                    onClick={() => handleBusinessType('SERVICE')}
                                    className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-primary-500/50 rounded-2xl p-6 text-left transition-all group"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                                            <Scissors className="w-6 h-6 text-purple-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-white mb-1 group-hover:text-primary-400 transition-colors">
                                                Service Business
                                            </h3>
                                            <p className="text-gray-400 text-sm">
                                                Book appointments and services. Manage availability and bookings.
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            </div>

                            <div className="mt-6 text-center">
                                <p className="text-gray-400">
                                    Already have an account?{' '}
                                    <Link href="/login" className="text-primary-400 hover:text-primary-300 font-medium">
                                        Sign in
                                    </Link>
                                </p>
                            </div>
                        </>
                    ) : (
                        /* Step 2: Account Details */
                        <>
                            <button
                                onClick={() => setStep(1)}
                                className="flex items-center text-gray-400 hover:text-white mb-4 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Back
                            </button>

                            <div className="text-center mb-8">
                                <div className="inline-flex items-center bg-primary-500/20 text-primary-400 px-3 py-1 rounded-full text-sm mb-3">
                                    {formData.businessType === 'PRODUCT' ? (
                                        <><Package className="w-4 h-4 mr-1" /> Product Business</>
                                    ) : (
                                        <><Scissors className="w-4 h-4 mr-1" /> Service Business</>
                                    )}
                                </div>
                                <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
                                <p className="text-gray-400">Start your 14-day free trial</p>
                            </div>

                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Your Name
                                    </label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                        <input
                                            type="text"
                                            name="name"
                                            value={formData.name}
                                            onChange={handleChange}
                                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                                            placeholder="John Doe"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Business Name
                                    </label>
                                    <div className="relative">
                                        <Building className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                        <input
                                            type="text"
                                            name="businessName"
                                            value={formData.businessName}
                                            onChange={handleChange}
                                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                                            placeholder={formData.businessType === 'PRODUCT' ? 'My Store' : 'Acme Salon'}
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Email
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                                            placeholder="you@example.com"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">
                                        Password
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                        <input
                                            type="password"
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                                            placeholder="••••••••"
                                            minLength={8}
                                            required
                                        />
                                    </div>
                                    <p className="text-gray-500 text-xs mt-1">Minimum 8 characters</p>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full gradient-primary text-white py-3 rounded-xl font-semibold flex items-center justify-center space-x-2 hover:shadow-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <>
                                            <span>Create Account</span>
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            </form>

                            <p className="text-gray-500 text-xs text-center mt-4">
                                By signing up, you agree to our Terms of Service and Privacy Policy
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

