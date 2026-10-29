/**
 * Public-facing constants that depend on where the site is deployed.
 *
 * Everything here is read from NEXT_PUBLIC_* env at build time so the same
 * code serves staging and production. Defaults point at the live domain so a
 * missing variable degrades to "correct for production", not "localhost".
 *
 * EVERY absolute URL on the site (canonical, Open Graph, sitemap, robots,
 * JSON-LD) is built from SITE_URL via `absoluteUrl()`. Moving to a new domain
 * is a config change only: set NEXT_PUBLIC_SITE_URL and rebuild.
 */

import { REGISTRATION_OPEN } from './feature-flags';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://bookly.ikieguy.online').replace(/\/$/, '');

/** `/pricing` → `https://…/pricing`. The one way to make an absolute URL. */
export const absoluteUrl = (path = '/'): string => (path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`);

export const SITE_NAME = 'Bookly';

export const SITE_TAGLINE = 'Your shop, always open.';

export const SITE_DESCRIPTION =
    'Bookly answers your WhatsApp while you work, books customers into real free times, takes the deposit by Mobile Money and sends the reminder.';

/** Ghana is the home market: en-GH for <html lang>, en_GH for Open Graph. */
export const SITE_LANG = 'en-GH';
export const SITE_OG_LOCALE = 'en_GH';

/** The share card rendered by app/opengraph-image.tsx. */
export const OG_IMAGE = { url: absoluteUrl('/opengraph-image'), width: 1200, height: 630, alt: `Bookly. ${SITE_TAGLINE}` };

/**
 * How customers reach a person. Either may be unset; the UI renders whichever
 * exists and hides the rest. The WhatsApp number is stored in international
 * digits only ("233201234567") and turned into a wa.me link here.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
export const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '').replace(/[^0-9]/g, '');

/**
 * The address the legal pages have always published for privacy and
 * data-subject requests. Overridable, but never empty: the Privacy Policy
 * must always name a contact.
 */
export const LEGAL_EMAIL = process.env.NEXT_PUBLIC_LEGAL_EMAIL || SUPPORT_EMAIL || 'support@bookly.ikieguy.online';

export const supportWhatsAppUrl = (text?: string): string | null =>
    SUPPORT_WHATSAPP
        ? `https://wa.me/${SUPPORT_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ''}`
        : null;

export const supportMailto = (subject?: string): string | null =>
    SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : null;

export const hasSupportContact = Boolean(SUPPORT_EMAIL || SUPPORT_WHATSAPP);

/** Analytics: set NEXT_PUBLIC_PLAUSIBLE_DOMAIN to the site's host to turn it on. */
export const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || '';

/**
 * Bookly's own social profiles, for Organization JSON-LD `sameAs`.
 * Comma-separated full URLs in NEXT_PUBLIC_SOCIAL_URLS; empty until they exist.
 */
export const SOCIAL_URLS = (process.env.NEXT_PUBLIC_SOCIAL_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//.test(s));

/**
 * Every public, indexable page. Feeds sitemap.ts. `updated` is the date the
 * page's content last changed: bump it when you edit the page.
 */
export const PUBLIC_PAGES: { path: string; updated: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }[] = [
    { path: '/', updated: '2026-10-26', priority: 1, changeFrequency: 'weekly' },
    { path: '/features', updated: '2026-10-26', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/features/whatsapp-bookings', updated: '2026-10-26', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/for/salons', updated: '2026-10-26', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/for/boutiques', updated: '2026-10-26', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/for/food-vendors', updated: '2026-10-26', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/pricing', updated: '2026-10-26', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/faq', updated: '2026-10-26', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/about', updated: '2026-10-26', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/support', updated: '2026-10-26', priority: 0.5, changeFrequency: 'monthly' },
    // While sign-up is closed /register only works with an invite: list the waitlist instead.
    ...(REGISTRATION_OPEN
        ? [{ path: '/register', updated: '2026-10-26', priority: 0.6, changeFrequency: 'monthly' as const }]
        : [{ path: '/waitlist', updated: '2026-10-29', priority: 0.8, changeFrequency: 'monthly' as const }]),
    { path: '/login', updated: '2026-10-26', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/privacy', updated: '2026-10-29', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms', updated: '2026-05-14', priority: 0.3, changeFrequency: 'yearly' },
];

/**
 * Signed-in and transactional routes. None of these are for search engines:
 * robots.ts disallows them and next.config.js sends `X-Robots-Tag: noindex`.
 * Keep in sync with the folders in src/app AND with NOINDEX_ROUTES in
 * next.config.js (plain JS, so it can't import this file).
 * `/c/` keeps its slash: robots rules are prefixes, and a bare `/c` would
 * also match any future public page starting with "c".
 */
export const PRIVATE_ROUTES = [
    '/dashboard', '/bookings', '/services', '/availability', '/conversations', '/customers',
    '/channels', '/whatsapp', '/templates', '/settings', '/orders', '/products', '/inventory',
    '/money', '/admin', '/design-system', '/pay', '/track', '/c/', '/forgot-password',
    '/reset-password', '/verify-email', '/offline', '/api',
] as const;
