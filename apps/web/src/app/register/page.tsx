'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Mail, Lock, User, Building, ArrowRight, ArrowLeft, Package, Scissors, AlertCircle } from 'lucide-react';
import { Badge, Button, Input, cn, ease } from '@bookingflow/ui';
import { AuthAlert, AuthFootnote, AuthFrame, AuthTitle, authLink, authMutedLink } from '@/components/auth/auth-frame';
import { useInlineValidation } from '@/components/auth/use-inline-validation';
import { PRODUCT_MODE_ENABLED } from '@/lib/feature-flags';
import { RotatingChannel } from '@/components/brand/rotating-channel';

type BusinessType = 'PRODUCT' | 'SERVICE';

/** Where a brand-new account lands: the short setup checklist. */
const AFTER_SIGNUP = '/onboarding';

export default function RegisterPage() {
    const router = useRouter();
    const { register } = useAuth();
    const reduce = useReducedMotion();
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
    const [termsError, setTermsError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [agreed, setAgreed] = useState(false);
    const { field } = useInlineValidation();
    const fields = {
        name: field('name', { missing: 'Please tell us your name.' }),
        businessName: field('businessName', { missing: 'What is your business called?' }),
        email: field('email', {
            missing: 'Please enter your email.',
            format: "That email doesn't look right. Check for a missing @ or dot.",
        }),
        password: field('password', {
            missing: 'Please choose a password.',
            short: 'Use at least 8 characters.',
        }),
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        fields[e.target.name as keyof typeof fields]?.recheck(e.target);
    };

    const handleBusinessType = (type: BusinessType) => {
        setFormData({ ...formData, businessType: type });
        setStep(2);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!agreed) {
            setTermsError('Please agree to the Terms and Privacy Policy to continue.');
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
            router.push(AFTER_SIGNUP);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    const slide = (dir: number) =>
        reduce
            ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 } }
            : {
                  initial: { opacity: 0, x: 16 * dir },
                  animate: { opacity: 1, x: 0 },
                  exit: { opacity: 0, x: 16 * dir },
                  transition: { duration: 0.25, ease: ease.out },
              };

    return (
        <AuthFrame
            statement={
                <>
                    Set up this afternoon.{' '}
                    <span className="text-cream/70">Taking bookings on <RotatingChannel /> by tonight.</span>
                </>
            }
        >
            <AnimatePresence mode="wait" initial={false}>
                {step === 1 ? (
                    <motion.div key="step-1" {...slide(-1)}>
                        <AuthTitle sub="Pick the one that sounds most like you. You can change it later.">
                            What kind of business?
                        </AuthTitle>

                        <div className="space-y-3">
                            <TypeCard
                                icon={<Package />}
                                title="I sell products"
                                body="Clothes, food, beauty products and more. Take orders and payments on WhatsApp."
                                onClick={() => handleBusinessType('PRODUCT')}
                            />
                            <TypeCard
                                icon={<Scissors />}
                                title="I offer services"
                                body="Hair, nails, barbering, repairs and more. Customers book a time on WhatsApp."
                                onClick={() => handleBusinessType('SERVICE')}
                            />
                        </div>

                        <AuthFootnote>
                            Already have an account?{' '}
                            <Link href="/login" className={authLink}>
                                Log in
                            </Link>
                        </AuthFootnote>
                    </motion.div>
                ) : (
                    <motion.div key="step-2" {...slide(1)}>
                        {PRODUCT_MODE_ENABLED && (
                            <button type="button" onClick={() => setStep(1)} className={cn(authMutedLink, 'mb-2')}>
                                <ArrowLeft className="h-4 w-4" aria-hidden />
                                Back
                            </button>
                        )}

                        {PRODUCT_MODE_ENABLED && (
                            <Badge variant="success" className="mb-4">
                                {formData.businessType === 'PRODUCT' ? (
                                    <><Package className="h-3.5 w-3.5" aria-hidden /> Sells products</>
                                ) : (
                                    <><Scissors className="h-3.5 w-3.5" aria-hidden /> Offers services</>
                                )}
                            </Badge>
                        )}
                        <AuthTitle sub="Free for 14 days. No card needed. Takes about a minute.">
                            Create your account
                        </AuthTitle>

                        {error && (
                            <AuthAlert>
                                {error.replace(/\.\s*$/, '')}. Check the details below and try again. Already signed up?{' '}
                                <Link href="/login" className={authLink}>
                                    Log in instead
                                </Link>
                                .
                            </AuthAlert>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <Input
                                type="text"
                                label="Your name"
                                icon={<User />}
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="Ama Mensah"
                                autoComplete="name"
                                required
                                {...fields.name.props}
                            />

                            <Input
                                type="text"
                                label="Business name"
                                icon={<Building />}
                                name="businessName"
                                value={formData.businessName}
                                onChange={handleChange}
                                placeholder={formData.businessType === 'PRODUCT' ? "Ama's Fabrics" : "Maison Skin Clinic"}
                                autoComplete="organization"
                                required
                                {...fields.businessName.props}
                            />

                            <Input
                                type="email"
                                label="Email"
                                icon={<Mail />}
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="you@example.com"
                                autoComplete="email"
                                inputMode="email"
                                hint="We'll send a link to confirm it."
                                required
                                {...fields.email.props}
                            />

                            <Input
                                type="password"
                                label="Password"
                                icon={<Lock />}
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                placeholder="At least 8 characters"
                                autoComplete="new-password"
                                minLength={8}
                                hint="At least 8 characters."
                                required
                                {...fields.password.props}
                            />

                            <div>
                                <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-[15px] text-muted">
                                    <input
                                        type="checkbox"
                                        checked={agreed}
                                        onChange={(e) => {
                                            setAgreed(e.target.checked);
                                            if (e.target.checked) setTermsError('');
                                        }}
                                        onInvalid={(e) => {
                                            e.preventDefault();
                                            setTermsError('Please agree to the Terms and Privacy Policy to continue.');
                                        }}
                                        required
                                        aria-invalid={termsError ? true : undefined}
                                        aria-describedby={termsError ? 'terms-error' : undefined}
                                        className="mt-0.5 h-5 w-5 shrink-0 rounded-[4px] border-border accent-primary"
                                    />
                                    <span>
                                        I agree to the{' '}
                                        <Link href="/terms" className={authLink} target="_blank">
                                            Terms
                                        </Link>{' '}
                                        and{' '}
                                        <Link href="/privacy" className={authLink} target="_blank">
                                            Privacy Policy
                                        </Link>
                                        .
                                    </span>
                                </label>
                                {termsError && (
                                    <p
                                        id="terms-error"
                                        role="alert"
                                        className="mt-1 flex items-start gap-1.5 text-[14px] font-medium text-error-fg"
                                    >
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                        {termsError}
                                    </p>
                                )}
                            </div>

                            <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Setting up your shop…">
                                Create my account <ArrowRight className="h-5 w-5" aria-hidden />
                            </Button>
                        </form>

                        <AuthFootnote>
                            Already have an account?{' '}
                            <Link href="/login" className={authLink}>
                                Log in
                            </Link>
                        </AuthFootnote>
                    </motion.div>
                )}
            </AnimatePresence>
        </AuthFrame>
    );
}

function TypeCard({
    icon,
    title,
    body,
    onClick,
}: {
    icon: React.ReactNode;
    title: string;
    body: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex w-full items-start gap-4 rounded-card border border-border bg-surface p-5 text-left shadow-card transition-[border-color,box-shadow,transform] duration-ui ease-brand-out hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card-hover active:scale-[0.99]"
        >
            <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary [&_svg]:h-5 [&_svg]:w-5"
                aria-hidden
            >
                {icon}
            </span>
            <span className="min-w-0">
                <span className="block text-[17px] font-bold text-text">{title}</span>
                <span className="mt-1 block text-[15px] leading-relaxed text-muted">{body}</span>
            </span>
        </button>
    );
}
