'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Building, Mail, MapPin, User } from 'lucide-react';
import { Button, Input, PhoneInput, Select, Textarea, TickPop, cn } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import {
    FIELD_ORDER,
    HEARD_FROM_OPTIONS,
    MESSAGE_MAX,
    WAITLIST_BUSINESS_TYPES,
    validateWaitlist,
    type WaitlistErrors,
    type WaitlistField,
    type WaitlistFormValues,
} from '@/lib/waitlist';

const EMPTY: WaitlistFormValues = {
    name: '', businessName: '', businessType: '', phone: '', phoneE164: null, email: '',
    city: '', heardFrom: '', message: '', consent: false,
};

const id = (field: WaitlistField) => `wl-${field}`;

/** The API's field names are the form's; anything else is shown as a form-level message. */
function apiFieldErrors(fields: unknown): WaitlistErrors {
    if (!Array.isArray(fields)) return {};
    const out: WaitlistErrors = {};
    for (const f of fields as Array<{ field?: string; message?: string }>) {
        if (f.field && (FIELD_ORDER as readonly string[]).includes(f.field) && f.message) {
            out[f.field as WaitlistField] = f.message;
        }
    }
    return out;
}

export function WaitlistForm() {
    const [values, setValues] = useState<WaitlistFormValues>(EMPTY);
    const [errors, setErrors] = useState<WaitlistErrors>({});
    const [touched, setTouched] = useState<Partial<Record<WaitlistField, boolean>>>({});
    const [formError, setFormError] = useState('');
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);
    // Honeypot: a real person never sees or fills it.
    const [website, setWebsite] = useState('');
    const successRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        if (done) successRef.current?.focus();
    }, [done]);

    const set = <K extends keyof WaitlistFormValues>(key: K, value: WaitlistFormValues[K], extra?: Partial<WaitlistFormValues>) => {
        const next = { ...values, [key]: value, ...extra };
        setValues(next);
        // Once a field has shown a message, re-check it as they type so it clears as soon as it's fixed.
        if (key !== 'phoneE164' && (touched[key as WaitlistField] || errors[key as WaitlistField])) {
            const msg = validateWaitlist(next)[key as WaitlistField];
            setErrors((prev) => ({ ...prev, [key]: msg }));
        }
    };

    const blur = (field: WaitlistField) => () => {
        const empty = field === 'consent' ? false : String(values[field] ?? '').trim() === '';
        // Don't nag an untouched empty field when someone just tabs through.
        if (empty && !errors[field]) return;
        setTouched((t) => ({ ...t, [field]: true }));
        setErrors((prev) => ({ ...prev, [field]: validateWaitlist(values)[field] }));
    };

    const focusFirst = (errs: WaitlistErrors) => {
        const first = FIELD_ORDER.find((f) => errs[f]);
        if (first) document.getElementById(id(first))?.focus();
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setFormError('');
        const errs = validateWaitlist(values);
        setErrors(errs);
        if (Object.keys(errs).length) {
            focusFirst(errs);
            return;
        }
        setSending(true);
        try {
            await api.post('/waitlist', {
                name: values.name.trim(),
                businessName: values.businessName.trim(),
                businessType: values.businessType,
                phone: values.phoneE164,
                email: values.email.trim(),
                city: values.city.trim(),
                heardFrom: values.heardFrom || undefined,
                message: values.message.trim() || undefined,
                consent: true,
                website,
            });
            track('Waitlist', { type: values.businessType });
            setDone(true);
        } catch (err: unknown) {
            const res = (err as { response?: { status?: number; data?: { fields?: unknown; message?: string } } })?.response;
            if (res?.status === 400) {
                const fieldErrs = apiFieldErrors(res.data?.fields);
                if (Object.keys(fieldErrs).length) {
                    setErrors(fieldErrs);
                    focusFirst(fieldErrs);
                    return;
                }
            }
            setFormError(
                res?.status === 429
                    ? "You've sent this a few times already. Please wait an hour and try again, or message us on WhatsApp."
                    : 'We could not send your details just now. Check your connection and try again.',
            );
        } finally {
            setSending(false);
        }
    };

    if (done) {
        return (
            <div className="flex flex-col items-center py-6 text-center sm:py-10" role="status" aria-live="polite">
                <TickPop size={72} label="You're on the list" />
                <h2
                    id="waitlist-form-title"
                    ref={successRef}
                    tabIndex={-1}
                    className="mt-6 text-[1.5rem] font-bold text-text outline-none sm:text-[1.75rem]"
                >
                    You&apos;re on the list.
                </h2>
                <p className="mt-3 max-w-md text-body text-muted sm:text-[1.0625rem]">
                    We&apos;ll message you on WhatsApp or email when it&apos;s your turn.
                    {values.email && <> We&apos;ve also sent a note to <span className="font-semibold text-text break-all">{values.email.trim()}</span>.</>}
                </p>
                <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                    <Link
                        href="/features"
                        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-6 text-base font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover"
                    >
                        See what Bookly does <ArrowRight className="h-5 w-5" aria-hidden />
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex min-h-[48px] items-center justify-center rounded-control border border-border bg-surface px-6 text-base font-semibold text-text transition-colors duration-ui hover:bg-surface-2"
                    >
                        Back to home
                    </Link>
                </div>
            </div>
        );
    }

    const messageLeft = MESSAGE_MAX - values.message.length;

    return (
        <form onSubmit={submit} noValidate method="post" className="space-y-5" aria-describedby={formError ? 'wl-form-error' : undefined}>
            <div>
                <h2 id="waitlist-form-title" className="text-[1.25rem] font-bold text-text sm:text-[1.5rem]">
                    Tell us about your business
                </h2>
                <p className="mt-1 text-body text-muted">It takes about a minute.</p>
            </div>

            {formError && (
                <div id="wl-form-error" role="alert" className="flex items-start gap-3 rounded-control border border-error/30 bg-error-soft px-4 py-3 text-[15px] text-text">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error-fg" aria-hidden />
                    <div>
                        <p className="font-semibold">Oops, that didn&apos;t work. Let&apos;s try again.</p>
                        <p className="mt-1 text-muted">{formError}</p>
                    </div>
                </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
                <Input
                    id={id('name')}
                    label="Your name"
                    icon={<User />}
                    value={values.name}
                    onChange={(e) => set('name', e.target.value)}
                    onBlur={blur('name')}
                    error={errors.name}
                    placeholder="Ama Mensah"
                    autoComplete="name"
                    maxLength={120}
                    required
                />
                <Input
                    id={id('businessName')}
                    label="Business name"
                    icon={<Building />}
                    value={values.businessName}
                    onChange={(e) => set('businessName', e.target.value)}
                    onBlur={blur('businessName')}
                    error={errors.businessName}
                    placeholder="Maison Skin Clinic"
                    autoComplete="organization"
                    maxLength={120}
                    required
                />
            </div>

            <Select
                id={id('businessType')}
                label="What kind of business?"
                value={values.businessType}
                onChange={(e) => set('businessType', e.target.value)}
                onBlur={blur('businessType')}
                error={errors.businessType}
                required
            >
                <option value="" disabled>Choose one…</option>
                {WAITLIST_BUSINESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>

            <div className="grid gap-5 sm:grid-cols-2">
                <PhoneInput
                    id={id('phone')}
                    label="WhatsApp number"
                    value={values.phone}
                    onChange={(display, e164) => set('phone', display, { phoneE164: e164 })}
                    onBlur={blur('phone')}
                    error={errors.phone}
                    hint="We'll message you here when it's your turn."
                    required
                />
                <Input
                    id={id('email')}
                    type="email"
                    label="Email"
                    icon={<Mail />}
                    value={values.email}
                    onChange={(e) => set('email', e.target.value)}
                    onBlur={blur('email')}
                    error={errors.email}
                    placeholder="you@example.com"
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    required
                />
            </div>

            <Input
                id={id('city')}
                label="Town or area"
                icon={<MapPin />}
                value={values.city}
                onChange={(e) => set('city', e.target.value)}
                onBlur={blur('city')}
                error={errors.city}
                placeholder="East Legon, Accra"
                autoComplete="address-level2"
                maxLength={120}
                required
            />

            <Select
                id={id('heardFrom')}
                label="How did you hear about Bookly? (optional)"
                value={values.heardFrom}
                onChange={(e) => set('heardFrom', e.target.value)}
            >
                <option value="">Choose one…</option>
                {HEARD_FROM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>

            <Textarea
                id={id('message')}
                label="Anything else we should know? (optional)"
                value={values.message}
                onChange={(e) => set('message', e.target.value)}
                onBlur={blur('message')}
                error={errors.message}
                rows={3}
                maxLength={MESSAGE_MAX}
                placeholder="What you'd like Bookly to handle, how many staff you have…"
                hint={<span aria-live="polite">{messageLeft} characters left</span>}
            />

            {/* Honeypot: off-screen, out of the tab order and hidden from screen readers. */}
            <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                <label htmlFor="wl-website">Website</label>
                <input
                    id="wl-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                />
            </div>

            <div>
                <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-[15px] text-muted">
                    <input
                        id={id('consent')}
                        type="checkbox"
                        checked={values.consent}
                        onChange={(e) => set('consent', e.target.checked)}
                        aria-invalid={errors.consent ? true : undefined}
                        aria-describedby={errors.consent ? 'wl-consent-error' : undefined}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded-[4px] border-border accent-primary"
                    />
                    <span>
                        Bookly may contact me about the waitlist on WhatsApp or email, and keep these details as set out in the{' '}
                        <Link href="/privacy" target="_blank" className="font-semibold text-primary underline-offset-4 hover:underline">
                            Privacy Policy
                        </Link>
                        .
                    </span>
                </label>
                {errors.consent && (
                    <p id="wl-consent-error" role="alert" className="mt-1 flex items-start gap-1.5 text-[14px] font-medium text-error-fg">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {errors.consent}
                    </p>
                )}
            </div>

            <Button type="submit" size="lg" fullWidth isLoading={sending} loadingText="Adding you to the list…" className={cn('sm:w-auto sm:px-8')}>
                Join the waitlist <ArrowRight className="h-5 w-5" aria-hidden />
            </Button>
        </form>
    );
}
