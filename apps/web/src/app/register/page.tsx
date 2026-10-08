'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, Building, ArrowRight, ArrowLeft, Package, Scissors } from 'lucide-react';
import { Input } from '@bookingflow/ui';
import {
    AuthFrame,
    authErrorBox,
    authFormClass,
    authHeading,
    authInputClass,
    authLink,
    authPrimaryBtn,
    authSub,
} from '@/components/auth/auth-frame';
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
    const [agreed, setAgreed] = useState(false);

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
        if (!agreed) {
            setError('Please agree to the Terms and Privacy Policy to continue.');
            return;
        }
        setIsLoading(true);

        try {
            await register({
                ...formData,
                businessType: formData.businessType as BusinessType,
                acceptTerms: true,
                // The browser knows where the business is; the server would
                // otherwise default to UTC and every slot would be off.
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Accra',
            });
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthFrame
            statement={
                <>
                    Set up this afternoon.{' '}
                    <span className="text-forest-cream/50">Taking bookings on WhatsApp by tonight.</span>
                </>
            }
        >
            <div>
                    <AnimatePresence mode="wait">
                        {step === 1 ? (
                            <motion.div
                                key="step-1"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3 }}
                            >
                                <div className="mb-8">
                                    <h1 className={`${authHeading} mb-3`}>What type of business?</h1>
                                    <p className={authSub}>Choose how you want to sell via WhatsApp</p>
                                </div>

                                <div className="space-y-3">
                                    <motion.button
                                        whileHover={{ y: -2 }}
                                        whileTap={{ scale: 0.99 }}
                                        onClick={() => handleBusinessType('PRODUCT')}
                                        className="w-full bg-[#FBFAF7] border border-forest-ink/[.12] hover:border-forest-brand/50 rounded-[6px] p-5 text-left shadow-[0_14px_30px_-22px_rgba(20,26,22,0.45)] transition-colors group focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-brand/30"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 bg-forest-night text-forest-cream rounded-[4px] flex items-center justify-center flex-shrink-0">
                                                <Package className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-[17px] font-medium tracking-[-0.02em] text-forest-ink mb-1">
                                                    Product Business
                                                </h3>
                                                <p className="text-[13px] text-[#5F675E] leading-relaxed">
                                                    Sell physical or digital products. Manage inventory, orders, and deliveries.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.button>

                                    <motion.button
                                        whileHover={{ y: -2 }}
                                        whileTap={{ scale: 0.99 }}
                                        onClick={() => handleBusinessType('SERVICE')}
                                        className="w-full bg-[#FBFAF7] border border-forest-ink/[.12] hover:border-forest-brand/50 rounded-[6px] p-5 text-left shadow-[0_14px_30px_-22px_rgba(20,26,22,0.45)] transition-colors group focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest-brand/30"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 bg-forest-night text-forest-cream rounded-[4px] flex items-center justify-center flex-shrink-0">
                                                <Scissors className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-[17px] font-medium tracking-[-0.02em] text-forest-ink mb-1">
                                                    Service Business
                                                </h3>
                                                <p className="text-[13px] text-[#5F675E] leading-relaxed">
                                                    Book appointments and services. Manage availability and bookings.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.button>
                                </div>

                                <div className="mt-6 text-center">
                                    <p className="text-[13px] text-[#5F675E]">
                                        Already have an account?{' '}
                                        <Link href="/login" className={authLink}>
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
                                        className="flex items-center min-h-[44px] text-[#5F675E] hover:text-forest-ink mb-2 transition-colors text-[13px]"
                                    >
                                        <ArrowLeft className="w-4 h-4 mr-1.5" />
                                        Back
                                    </button>
                                )}

                                <div className="mb-8">
                                    <div className="fs-badge mb-4">
                                        {formData.businessType === 'PRODUCT' ? (
                                            <><Package className="w-3 h-3" /> Product business</>
                                        ) : (
                                            <><Scissors className="w-3 h-3" /> Service business</>
                                        )}
                                    </div>
                                    <h1 className={`${authHeading} mb-3`}>Create your account.</h1>
                                    <p className={authSub}>Start your 14-day free Pro trial</p>
                                </div>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`${authErrorBox} mb-5`}
                                    >
                                        {error}
                                    </motion.div>
                                )}

                                <form onSubmit={handleSubmit} className={authFormClass}>
                                    <Input
                                        type="text"
                                        label="Your Name"
                                        icon={<User className="w-[18px] h-[18px]" />}
                                        name="name"
                                        value={formData.name}
                                        onChange={handleChange}
                                        placeholder="Ama Mensah"
                                        className={authInputClass}
                                        required
                                    />

                                    <Input
                                        type="text"
                                        label="Business Name"
                                        icon={<Building className="w-[18px] h-[18px]" />}
                                        name="businessName"
                                        value={formData.businessName}
                                        onChange={handleChange}
                                        placeholder={formData.businessType === 'PRODUCT' ? "Ama's Fabrics" : "Ama's Hair Studio"}
                                        className={authInputClass}
                                        required
                                    />

                                    <Input
                                        type="email"
                                        label="Email"
                                        icon={<Mail className="w-[18px] h-[18px]" />}
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                        placeholder="you@example.com"
                                        className={authInputClass}
                                        required
                                    />

                                    <div>
                                        <Input
                                            type="password"
                                            label="Password"
                                            icon={<Lock className="w-[18px] h-[18px]" />}
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            placeholder="••••••••"
                                            minLength={8}
                                            className={authInputClass}
                                            required
                                        />
                                        <p className="text-[#5F675E] text-[12px] mt-1.5">At least 8 characters.</p>
                                    </div>

                                <label className="flex items-start gap-3 text-[13px] text-[#5F675E] cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={agreed}
                                        onChange={(e) => setAgreed(e.target.checked)}
                                        required
                                        className="mt-0.5 h-5 w-5 shrink-0 rounded-[3px] border-forest-ink/30 bg-[#FBFAF7] text-forest-brand accent-[#2F5640] focus:ring-forest-brand/30 focus:ring-offset-0"
                                    />
                                    <span>
                                        I agree to the{' '}
                                        <Link href="/terms" className="text-forest-ink underline underline-offset-2" target="_blank">Terms</Link>
                                        {' '}and{' '}
                                        <Link href="/privacy" className="text-forest-ink underline underline-offset-2" target="_blank">Privacy Policy</Link>.
                                    </span>
                                </label>

                                    <button type="submit" disabled={isLoading} className={authPrimaryBtn}>
                                        {isLoading ? 'Creating…' : (<>Create account <ArrowRight className="w-4 h-4" /></>)}
                                    </button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>
            </div>
        </AuthFrame>
    );
}
