/**
 * The site's one "get started" call to action, which depends on whether
 * self sign-up is open (lib/feature-flags.ts). Every marketing CTA, the
 * footer link and the login page read it from here, so flipping the flag
 * changes them all at once.
 *
 * Open:   "Start free"    → /register  (Plausible goal `Signup` on click)
 * Closed: "Join waitlist" → /waitlist  (no click goal; `Waitlist` is reported
 *                                       when someone actually joins)
 */
import type { AnalyticsEvent } from './analytics';
import { REGISTRATION_OPEN } from './feature-flags';

export interface SignupCta {
    href: '/register' | '/waitlist';
    label: string;
    /** Footer / inline wording ("New to Bookly? …"). */
    inline: string;
    event?: AnalyticsEvent;
}

export const SIGNUP_CTA: SignupCta = REGISTRATION_OPEN
    ? { href: '/register', label: 'Start free', inline: 'Start free', event: 'Signup' }
    : { href: '/waitlist', label: 'Join waitlist', inline: 'Join the waitlist' };

/** Small print under a CTA. */
export const SIGNUP_REASSURANCE = REGISTRATION_OPEN
    ? 'No card needed. Nothing to set up first.'
    : "We're letting businesses in a few at a time.";
