import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import {
    OG_IMAGE, PLAUSIBLE_DOMAIN, SITE_DESCRIPTION, SITE_LANG, SITE_NAME, SITE_OG_LOCALE, SITE_TAGLINE, SITE_URL,
} from '@/lib/site';
import './globals.css';
import './fonts.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import { AnalyticsEvents } from '@/components/marketing/analytics-events';

// Fonts are self-hosted (public/fonts, @font-face in ./fonts.css): Bricolage
// Grotesque (--font-sans) for everything, Clash Display (--font-display) for
// the logo, page titles and hero only. The two main files are preloaded below.

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#FAF6EE' },
        { media: '(prefers-color-scheme: dark)', color: '#1F2328' },
    ],
};

/**
 * Site-wide defaults. Every public page overrides title, description,
 * canonical and Open Graph through `pageMetadata()` (lib/seo.ts); signed-in
 * pages only set a title and are kept out of search by robots.ts and the
 * X-Robots-Tag header in next.config.js.
 */
export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    title: {
        default: `Bookly: ${SITE_TAGLINE}`,
        // Every app page sets its own title; this keeps the brand on the tab.
        template: '%s · Bookly',
    },
    description: SITE_DESCRIPTION,
    keywords: [
        'WhatsApp booking system Ghana', 'salon booking app Ghana', 'automate WhatsApp orders Accra',
        'WhatsApp bookings', 'Mobile Money deposits', 'appointment reminders', 'small business Ghana',
    ],
    openGraph: {
        type: 'website',
        siteName: SITE_NAME,
        title: `Bookly: ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        locale: SITE_OG_LOCALE,
        images: [OG_IMAGE],
    },
    twitter: {
        card: 'summary_large_image',
        title: `Bookly: ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        images: [OG_IMAGE.url],
    },
    robots: { index: true, follow: true },
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'Bookly',
    },
    formatDetection: {
        telephone: false,
    },
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: '32x32' },
            { url: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
            { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        ],
        apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
    other: {
        'mobile-web-app-capable': 'yes',
        'geo.region': 'GH',
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        // Cream (light) is the default; charcoal is the planned dark option. next-themes toggles
        // a `dark`/`light` class on <html> at runtime; `suppressHydrationWarning`
        // is required because the class is set before hydration.
        <html lang={SITE_LANG} suppressHydrationWarning>
            <head>
                <link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
                <link rel="preload" href="/fonts/clash-display-600.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
            </head>
            <body className="bg-bg text-text font-sans antialiased">
                {/* Keyboard and screen-reader users jump past the nav. Visible only on focus. */}
                <a
                    href="#main"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg focus:outline-none focus:ring-2 focus:ring-focus"
                >
                    Skip to content
                </a>
                <Providers>{children}</Providers>
                <ServiceWorkerRegistration />
                <AnalyticsEvents />
                {PLAUSIBLE_DOMAIN && (
                    // Cookieless analytics. Custom goals (Signup, Demo Request,
                    // WhatsApp Click) are sent by lib/analytics.ts `track()`.
                    <Script defer data-domain={PLAUSIBLE_DOMAIN} src="https://plausible.io/js/script.js" strategy="afterInteractive" />
                )}
            </body>
        </html>
    );
}
