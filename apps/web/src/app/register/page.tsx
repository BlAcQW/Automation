'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, Building, ArrowRight, ArrowLeft, Package, Scissors } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { GlowButton } from '@/components/primitives/glow-button';
import { BooklyWordmark } from '@/components/marketing/bookly-wordmark';
import { PRODUCT_MODE_ENABLED } from '@/lib/feature-flags';

type BusinessType = 'PRODUCT' | 'SERVICE';

export default function RegisterPage() {
    const router = useRouter();
    const { register } = useAuth();
    // PRODUCT mode is parked → skip Step 1 (the Product/Service picker) and
    // default to SERVICE. The picker code below stays intact for the day we
    // flip ENABLE_PRODUCT_MODE back on.
    const [step, setStep] = useState(PRODUCT_MODE_ENABLED ? 1 : 2);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        businessName: '',
        businessType: (PRODUCT_MODE_ENABLED ? '' : 'SERVICE') as BusinessType | '',
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
        <div className="min-h-screen bg-ink-950 text-ink-50 flex items-center justify-center px-4 py-12 relative overflow-hidden">
            {/* Atmospheric background */}
            <div aria-hidden className="absolute inset-0 bookly-glow opacity-60 pointer-events-none" />
            <div aria-hidden className="absolute inset-0 bg-grid opacity-40 pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md relative z-10"
            >
                {/* Logo */}
                <div className="text-center mb-8">
                    <Link href="/" className="inline-block">
                        <BooklyWordmark size="lg" />
                    </Link>
                </div>

                {/* Card */}
                <div className="rounded-2xl border border-ink-700 bg-ink-900/80 backdrop-blur-xl p-8 shadow-card-lg">
                    <AnimatePresence mode="wait">
                        {step === 1 ? (
                            <motion.div
                                key="step-1"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3 }}
                            >
                                <div className="text-center mb-8">
                                    <h1 className="font-display text-h1 text-ink-50 mb-2 tracking-tight">What type of business?</h1>
                                    <p className="text-body-sm text-ink-300">Choose how you want to sell via WhatsApp</p>
                                </div>

                                <div className="space-y-4">
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleBusinessType('PRODUCT')}
                                        className="w-full bg-ink-800/40 hover:bg-ink-800 border border-ink-700 hover:border-bookly-emerald-500/40 rounded-2xl p-6 text-left transition-all group"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500/30 transition-colors">
                                                <Package className="w-6 h-6 text-orange-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-display text-h3 text-ink-50 mb-1 group-hover:text-bookly-emerald-400 transition-colors">
                                                    Product Business
                                                </h3>
                                                <p className="text-body-sm text-ink-300 leading-relaxed">
                                                    Sell physical or digital products. Manage inventory, orders, and deliveries.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.button>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleBusinessType('SERVICE')}
                                        className="w-full bg-ink-800/40 hover:bg-ink-800 border border-ink-700 hover:border-bookly-emerald-500/40 rounded-2xl p-6 text-left transition-all group"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-purple-500/30 transition-colors">
                                                <Scissors className="w-6 h-6 text-purple-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-display text-h3 text-ink-50 mb-1 group-hover:text-bookly-emerald-400 transition-colors">
                                                    Service Business
                                                </h3>
                                                <p className="text-body-sm text-ink-300 leading-relaxed">
                                                    Book appointments and services. Manage availability and bookings.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.button>
                                </div>

                                <div className="mt-6 text-center">
                                    <p className="text-body-sm text-ink-300">
                                        Already have an account?{' '}
                                        <Link href="/login" className="text-bookly-emerald-400 hover:text-bookly-emerald-300 font-medium transition-colors">
                                            Sign in
                                        </Link>
                                    </p>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="step-2"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.3 }}
                            >
                                {PRODUCT_MODE_ENABLED && (
                                    <button
                                        onClick={() => setStep(1)}
                                        className="flex items-center text-ink-300 hover:text-ink-50 mb-4 transition-colors text-body-sm"
                                    >
                                        <ArrowLeft className="w-4 h-4 mr-1.5" />
                                        Back
                                    </button>
                                )}

                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center bg-bookly-emerald-500/15 text-bookly-emerald-300 px-3 py-1 rounded-full text-caption uppercase tracking-wider mb-3">
                                        {formData.businessType === 'PRODUCT' ? (
                                            <><Package className="w-3.5 h-3.5 mr-1.5" /> Product Business</>
                                        ) : (
                                            <><Scissors className="w-3.5 h-3.5 mr-1.5" /> Service Business</>
                                        )}
                                    </div>
                                    <h1 className="font-display text-h1 text-ink-50 mb-2 tracking-tight">Create your account</h1>
                                    <p className="text-body-sm text-ink-300">Start your 14-day free Pro trial</p>
                                </div>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl mb-6 text-body-sm"
                                    >
                                        {error}
                                    </motion.div>
                                )}

                                <form onSubmit={handleSubmit} className="space-y-5">
                                    <Input
                                        type="text"
                                        label="Your Name"
                                        icon={<User className="w-5 h-5" />}
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        placeholder="John Doe"
                                        required
                                    />

                                    <Input
                                        type="text"
                                        label="Business Name"
                                        icon={<Building className="w-5 h-5" />}
                                        name="businessName"
                                        value={formData.businessName}
                                        onChange={handleChange}
                                        placeholder={formData.businessType === 'PRODUCT' ? 'My Store' : 'Acme Salon'}
                                        required
                                    />

                                    <Input
                                        type="email"
                                        label="Email"
                                        icon={<Mail className="w-5 h-5" />}
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        placeholder="you@example.com"
                                        required
                                    />

                                    <div>
                                        <Input
                                            type="password"
                                            label="Password"
                                            icon={<Lock className="w-5 h-5" />}
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            placeholder="••••••••"
                                            minLength={8}
                                            required
                                        />
                                        <p className="text-ink-400 text-caption uppercase tracking-wider mt-1.5">Minimum 8 characters</p>
                                    </div>

                                    <GlowButton
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full"
                                        size="lg"
                                    >
                                        {isLoading ? 'Creating…' : (<>Create account <ArrowRight className="w-4 h-4" /></>)}
                                    </GlowButton>
                                </form>

                                <p className="text-caption uppercase tracking-wider text-ink-400 text-center mt-4">
                                    By signing up, you agree to our Terms and Privacy Policy
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}
