/**
 * Public-facing constants that depend on where the site is deployed.
 *
 * Everything here is read from NEXT_PUBLIC_* env at build time so the same
 * code serves staging and production. Defaults point at the live domain so a
 * missing variable degrades to "correct for production", not "localhost".
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://bookly.ikieguy.online').replace(/\/$/, '');

export const SITE_NAME = 'Bookly';

export const SITE_DESCRIPTION =
    'Your customers message you on WhatsApp. Bookly books the appointment, takes the deposit and sends the reminder.';

/**
 * How customers reach a person. Either may be unset; the UI renders whichever
 * exists and hides the rest. The WhatsApp number is stored in international
 * digits only ("233201234567") and turned into a wa.me link here.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
export const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '').replace(/[^0-9]/g, '');

export const supportWhatsAppUrl = (text?: string): string | null =>
    SUPPORT_WHATSAPP
        ? `https://wa.me/${SUPPORT_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ''}`
        : null;

export const supportMailto = (subject?: string): string | null =>
    SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : null;

export const hasSupportContact = Boolean(SUPPORT_EMAIL || SUPPORT_WHATSAPP);

/** Analytics: set NEXT_PUBLIC_PLAUSIBLE_DOMAIN to the site's host to turn it on. */
export const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || '';
