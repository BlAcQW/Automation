import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { PLAUSIBLE_DOMAIN, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import './globals.css';
import './fonts.css';
import './marketing.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';

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

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: 'Bookly: WhatsApp bookings for small businesses',
        // Every app page sets its own title; this keeps the brand on the tab.
        template: '%s · Bookly',
    },
    description: SITE_DESCRIPTION,
    keywords: ['whatsapp', 'bookings', 'appointments', 'salon', 'small business', 'ghana', 'deposit'],
    openGraph: {
        type: 'website',
        siteName: SITE_NAME,
        title: 'Bookly: your bookings, taken on WhatsApp',
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        locale: 'en_GH',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Bookly: your bookings, taken on WhatsApp',
        description: SITE_DESCRIPTION,
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
        <html lang="en" suppressHydrationWarning>
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
                {PLAUSIBLE_DOMAIN && (
                    <Script defer data-domain={PLAUSIBLE_DOMAIN} src="https://plausible.io/js/script.js" strategy="afterInteractive" />
                )}
            </body>
        </html>
    );
}
