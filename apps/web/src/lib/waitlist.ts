/**
 * Waitlist vocabulary shared by the public /waitlist form and the admin page.
 * MIRRORS apps/api/src/services/waitlist.ts (business types, statuses, limits):
 * keep both in step. The API validates everything again; this only keeps the
 * form friendly.
 */
import { isValidGhanaPhone } from '@bookingflow/ui';

/** Premium, appointment-heavy businesses first (the ones Bookly is pitched at). */
export const WAITLIST_BUSINESS_TYPES = [
    { value: 'skin_clinic', label: 'Skin or aesthetics clinic' },
    { value: 'spa', label: 'Spa' },
    { value: 'dental', label: 'Dental clinic' },
    { value: 'tailoring', label: 'Tailoring or fashion design' },
    { value: 'private_chef', label: 'Private chef or catering' },
    { value: 'photography', label: 'Photography' },
    { value: 'fitness', label: 'Fitness, pilates or yoga' },
    { value: 'car_detailing', label: 'Car detailing' },
    { value: 'salon_barber', label: 'Salon or barber' },
    { value: 'boutique', label: 'Boutique' },
    { value: 'food', label: 'Food vendor' },
    { value: 'other', label: 'Something else' },
] as const;

export type WaitlistBusinessType = (typeof WAITLIST_BUSINESS_TYPES)[number]['value'];

export const BUSINESS_TYPE_LABEL: Record<string, string> = Object.fromEntries(
    WAITLIST_BUSINESS_TYPES.map((t) => [t.value, t.label]),
);

export const HEARD_FROM_OPTIONS = [
    'Instagram',
    'TikTok',
    'Facebook',
    'WhatsApp status or group',
    'A friend or client',
    'Google search',
    'Somewhere else',
] as const;

export const WAITLIST_STATUSES = ['NEW', 'CONTACTED', 'INVITED', 'JOINED', 'DECLINED'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const STATUS_LABEL: Record<WaitlistStatus, string> = {
    NEW: 'New',
    CONTACTED: 'Contacted',
    INVITED: 'Invited',
    JOINED: 'Joined',
    DECLINED: 'Declined',
};

/** StatusPill tone per status: icon + word + colour, never colour alone. */
export const STATUS_TONE: Record<WaitlistStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
    NEW: 'warning',
    CONTACTED: 'neutral',
    INVITED: 'warning',
    JOINED: 'success',
    DECLINED: 'error',
};

export const MESSAGE_MAX = 500;

export interface WaitlistFormValues {
    name: string;
    businessName: string;
    businessType: string;
    /** As typed (display); the e164 is sent. */
    phone: string;
    phoneE164: string | null;
    email: string;
    city: string;
    heardFrom: string;
    message: string;
    consent: boolean;
}

export type WaitlistField = keyof Omit<WaitlistFormValues, 'phoneE164'>;
export type WaitlistErrors = Partial<Record<WaitlistField, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Friendly, field-by-field messages. Empty object = good to send. */
export function validateWaitlist(v: WaitlistFormValues): WaitlistErrors {
    const errors: WaitlistErrors = {};
    if (v.name.trim().length < 2) errors.name = 'Please tell us your name.';
    if (v.businessName.trim().length < 2) errors.businessName = 'What is your business called?';
    if (!v.businessType) errors.businessType = 'Choose the kind of business.';
    if (!v.phone.trim()) errors.phone = 'We need a WhatsApp number to reach you.';
    else if (!v.phoneE164 || !isValidGhanaPhone(v.phoneE164)) errors.phone = "That number doesn't look right. Try 24 412 3456.";
    if (!v.email.trim()) errors.email = 'Please enter your email.';
    else if (!EMAIL.test(v.email.trim())) errors.email = "That email doesn't look right. Check for a missing @ or dot.";
    if (v.city.trim().length < 2) errors.city = 'Which town or area are you in?';
    if (v.message.length > MESSAGE_MAX) errors.message = `Keep it under ${MESSAGE_MAX} characters.`;
    if (!v.consent) errors.consent = 'Please agree so we can contact you.';
    return errors;
}

/** Order the fields appear in, for focusing the first problem. */
export const FIELD_ORDER: readonly WaitlistField[] = [
    'name', 'businessName', 'businessType', 'phone', 'email', 'city', 'heardFrom', 'message', 'consent',
];
