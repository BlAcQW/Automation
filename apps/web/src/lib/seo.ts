import type { Metadata } from 'next';
import {
    LEGAL_EMAIL, OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_OG_LOCALE, SITE_TAGLINE, SOCIAL_URLS,
    SUPPORT_WHATSAPP, absoluteUrl,
} from '@/lib/site';

/**
 * Per-page metadata for public pages. Titles are written in full here
 * (`absolute`) so each one is unique and under 60 characters; descriptions
 * stay under 160. Canonical, Open Graph and Twitter all derive from SITE_URL.
 */
export interface PageSeo {
    title: string;
    description: string;
    path: string;
    noindex?: boolean;
}

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export function pageMetadata({ title, description, path, noindex }: PageSeo): Metadata {
    const url = absoluteUrl(path);
    return {
        title: { absolute: title },
        description,
        alternates: { canonical: url, languages: { 'en-GH': url } },
        openGraph: {
            type: 'website',
            siteName: SITE_NAME,
            locale: SITE_OG_LOCALE,
            url,
            title,
            description,
            images: [OG_IMAGE],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [OG_IMAGE.url],
        },
        robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    };
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

type JsonLd = Record<string, unknown>;

export function organizationJsonLd(): JsonLd {
    const contactPoint: JsonLd[] = [
        { '@type': 'ContactPoint', contactType: 'customer support', email: LEGAL_EMAIL, areaServed: 'GH', availableLanguage: ['en'] },
    ];
    if (SUPPORT_WHATSAPP) contactPoint[0] = { ...contactPoint[0], telephone: `+${SUPPORT_WHATSAPP}` };
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': absoluteUrl('/#organization'),
        name: SITE_NAME,
        slogan: SITE_TAGLINE,
        url: absoluteUrl('/'),
        logo: absoluteUrl('/icons/icon-512.png'),
        description: SITE_DESCRIPTION,
        areaServed: { '@type': 'Country', name: 'Ghana' },
        contactPoint,
        ...(SOCIAL_URLS.length ? { sameAs: SOCIAL_URLS } : {}),
    };
}

/**
 * Bookly as an app. No `offers` yet: prices are "coming soon", and the brief
 * forbids inventing them. Add a GHS Offer here when real prices are public.
 */
export function softwareApplicationJsonLd(): JsonLd {
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'WhatsApp booking system',
        operatingSystem: 'Web, Android, iOS',
        url: absoluteUrl('/'),
        description: SITE_DESCRIPTION,
        inLanguage: 'en-GH',
        areaServed: { '@type': 'Country', name: 'Ghana' },
        publisher: { '@id': absoluteUrl('/#organization') },
    };
}

export function faqJsonLd(items: readonly { q: string; a: string }[]): JsonLd {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map(({ q, a }) => ({
            '@type': 'Question',
            name: q,
            acceptedAnswer: { '@type': 'Answer', text: a },
        })),
    };
}

/** Crumbs after Home, e.g. [{ name: 'Features', path: '/features' }, …]. */
export function breadcrumbJsonLd(crumbs: readonly { name: string; path: string }[]): JsonLd {
    const all = [{ name: 'Home', path: '/' }, ...crumbs];
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: all.map((c, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: c.name,
            item: absoluteUrl(c.path),
        })),
    };
}
