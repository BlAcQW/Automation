'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Mail, Lock, User, Building, ArrowRight, ArrowLeft, Package, Scissors, AlertCircle } from 'lucide-react';
import { Badge, Button, Input, Skeleton, cn, ease } from '@bookingflow/ui';
import { AuthAlert, AuthFootnote, AuthFrame, AuthTitle, authLink, authMutedLink } from '@/components/auth/auth-frame';
import { useInlineValidation } from '@/components/auth/use-inline-validation';
import { PRODUCT_MODE_ENABLED, REGISTRATION_OPEN } from '@/lib/feature-flags';
import { RotatingChannel } from '@/components/brand/rotating-channel';

type BusinessType = 'PRODUCT' | 'SERVICE';

/** Where a brand-new account lands: the short setup checklist. */
const AFTER_SIGNUP = '/onboarding';

/**
 * Sign-up is closed while the waitlist is on (lib/feature-flags.ts): the form
 * only shows for a valid ?invite= link, with the invited email fixed. Without
 * an invite, middleware.ts sends people to /waitlist before this renders.
 * The sign-up flow itself is unchanged and comes back as it was when the
 * flag is flipped.
 */
type Gate =
    | { kind: 'open' }
    | { kind: 'checking' }
    | { kind: 'invited'; token: string; email: string; businessName: string; expiresAt: string }
    | { kind: 'refused'; reason: RefusedReason };

type RefusedReason = 'expired' | 'used' | 'invalid' | 'error';

/** API refusals (services/registration-gate.ts) that mean "this invite won't do". */
const INVITE_CODES: Record<string, RefusedReason> = {
    WAITLIST_ONLY: 'invalid',
    INVITE_INVALID: 'invalid',
    INVITE_EMAIL_MISMATCH: 'invalid',
    INVITE_EXPIRED: 'expired',
    INVITE_USED: 'used',
};

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
    const [gate, setGate] = useState<Gate>(REGISTRATION_OPEN ? { kind: 'open' } : { kind: 'checking' });

    // Read ?invite= in an effect (not useSearchParams) so the page still prerenders.
    useEffect(() => {
        const token = new URLSearchParams(window.location.search).get('invite')?.trim();
        if (!token) {
            if (!REGISTRATION_OPEN) router.replace('/waitlist');
            return;
        }
        let cancelled = false;
        api.get('/waitlist/invite', { params: { token } })
            .then(({ data }) => {
                if (cancelled) return;
                if (data?.status === 'valid') {
                    setGate({ kind: 'invited', token, email: data.email, businessName: data.businessName ?? '', expiresAt: data.expiresAt });
                    setFormData((f) => ({
                        ...f,
                        email: data.email,
                        name: f.name || data.name || '',
                        businessName: f.businessName || data.businessName || '',
                    }));
                } else if (!REGISTRATION_OPEN) {
                    setGate({ kind: 'refused', reason: data?.status === 'expired' || data?.status === 'used' ? data.status : 'invalid' });
                }
            })
            .catch(() => {
                if (!cancelled && !REGISTRATION_OPEN) setGate({ kind: 'refused', reason: 'error' });
            });
        return () => {
            cancelled = true;
        };
    }, [router]);
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
                ...(gate.kind === 'invited' && { inviteToken: gate.token }),
                // The browser knows where the business is; the server would
                // otherwise default to UTC and every slot would be off.
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Accra',
            });
            router.push(AFTER_SIGNUP);
        } catch (err: any) {
            const refusal = INVITE_CODES[err.response?.data?.code as string];
            if (refusal && !REGISTRATION_OPEN) {
                setGate({ kind: 'refused', reason: refusal });
                return;
            }
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
                {gate.kind === 'checking' ? (
                    <motion.div key="checking" aria-busy="true" {...slide(1)}>
                        <span className="sr-only">Checking your invite…</span>
                        <Skeleton className="h-10 w-3/4" />
                        <Skeleton className="mt-4 h-5 w-2/3" />
                        <div className="mt-8 space-y-5">
                            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-control" />)}
                        </div>
                    </motion.div>
                ) : gate.kind === 'refused' ? (
                    <motion.div key="refused" {...slide(1)}>
                        <InviteRefused reason={gate.reason} />
                    </motion.div>
                ) : step === 1 ? (
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

                        {gate.kind === 'invited' && (
                            <AuthAlert tone="notice" title="You've been invited">
                                Welcome off the waitlist
                                {gate.businessName ? <>, <strong className="text-text">{gate.businessName}</strong></> : null}. This invite is for{' '}
                                <strong className="break-all text-text">{gate.email}</strong> and works until {formatDay(gate.expiresAt)}.
                            </AuthAlert>
                        )}

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
                                hint={gate.kind === 'invited' ? 'Your invite is for this address.' : "We'll send a link to confirm it."}
                                readOnly={gate.kind === 'invited'}
                                className={gate.kind === 'invited' ? 'bg-surface-2' : undefined}
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

function formatDay(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'its expiry date' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

const REFUSED: Record<RefusedReason, { title: string; body: string }> = {
    expired: {
        title: 'This invite has expired',
        body: 'Invites work for 14 days. Message us and we will send you a fresh one.',
    },
    used: {
        title: 'This invite has already been used',
        body: 'An account was made with it. If it was yours, log in. You can reset your password from there.',
    },
    invalid: {
        title: "This invite link doesn't work",
        body: "Check you opened the whole link from your message. Bookly is invite-only for now, so if you don't have one, join the waitlist.",
    },
    error: {
        title: "We couldn't check your invite",
        body: 'Check your connection and open the link again.',
    },
};

/** An invite that can't be used: say why and where to go next. */
function InviteRefused({ reason }: { reason: RefusedReason }) {
    const copy = REFUSED[reason];
    const used = reason === 'used';
    return (
        <>
            <AuthTitle sub={copy.body}>{copy.title}</AuthTitle>
            <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                    href={used ? '/login' : '/waitlist'}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 text-base font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover"
                >
                    {used ? 'Log in' : 'Join the waitlist'} <ArrowRight className="h-5 w-5" aria-hidden />
                </Link>
                <Link
                    href={used ? '/forgot-password' : '/login'}
                    className="inline-flex min-h-[48px] items-center justify-center rounded-control border border-border bg-surface px-6 text-base font-semibold text-text transition-colors duration-ui hover:bg-surface-2"
                >
                    {used ? 'Reset my password' : 'I already have an account'}
                </Link>
            </div>
        </>
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
