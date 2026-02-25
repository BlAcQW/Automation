'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Mail, Lock, User, Building, ArrowRight, ArrowLeft, Loader2, Package, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
        <div className="min-h-screen bg-[#060b18] bg-grid flex items-center justify-center px-4 py-12 relative overflow-hidden">
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
                                    <h1 className="text-2xl font-bold text-white mb-2">What type of business?</h1>
                                    <p className="text-slate-400">Choose how you want to sell via WhatsApp</p>
                                </div>

                                <div className="space-y-4">
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleBusinessType('PRODUCT')}
                                        className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-6 text-left transition-all group"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 bg-orange-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500/30 transition-colors">
                                                <Package className="w-6 h-6 text-orange-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">
                                                    Product Business
                                                </h3>
                                                <p className="text-slate-400 text-sm leading-relaxed">
                                                    Sell physical or digital products. Manage inventory, orders, and deliveries.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.button>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleBusinessType('SERVICE')}
                                        className="w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-6 text-left transition-all group"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-purple-500/30 transition-colors">
                                                <Scissors className="w-6 h-6 text-purple-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">
                                                    Service Business
                                                </h3>
                                                <p className="text-slate-400 text-sm leading-relaxed">
                                                    Book appointments and services. Manage availability and bookings.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.button>
                                </div>

                                <div className="mt-6 text-center">
                                    <p className="text-slate-400">
                                        Already have an account?{' '}
                                        <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
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
                                <button
                                    onClick={() => setStep(1)}
                                    className="flex items-center text-slate-400 hover:text-white mb-4 transition-colors text-sm"
                                >
                                    <ArrowLeft className="w-4 h-4 mr-1.5" />
                                    Back
                                </button>

                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-sm mb-3 font-medium">
                                        {formData.businessType === 'PRODUCT' ? (
                                            <><Package className="w-4 h-4 mr-1.5" /> Product Business</>
                                        ) : (
                                            <><Scissors className="w-4 h-4 mr-1.5" /> Service Business</>
                                        )}
                                    </div>
                                    <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
                                    <p className="text-slate-400">Start your 14-day free trial</p>
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
                                        <p className="text-slate-600 text-xs mt-1.5">Minimum 8 characters</p>
                                    </div>

                                    <Button
                                        type="submit"
                                        isLoading={isLoading}
                                        className="w-full"
                                        size="lg"
                                    >
                                        Create Account <ArrowRight className="w-5 h-5" />
                                    </Button>
                                </form>

                                <p className="text-slate-600 text-xs text-center mt-4">
                                    By signing up, you agree to our Terms of Service and Privacy Policy
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}
