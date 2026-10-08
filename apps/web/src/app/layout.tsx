import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { PLAUSIBLE_DOMAIN, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import './globals.css';
import './forest-site.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import { GrainOverlay } from '@/components/primitives/grain-overlay';

// Inter Tight, loaded via Google Fonts CSS in globals.css. The `--font-sans`
// / `--font-mono` CSS vars are defined there and resolved by tailwind.config.ts.

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#E5E4DA' },
        { media: '(prefers-color-scheme: dark)', color: '#121D17' },
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
        // Paper (light) is the default; night forest is the dark option. next-themes toggles
        // a `dark`/`light` class on <html> at runtime; `suppressHydrationWarning`
        // is required because the class is set before hydration.
        <html lang="en" suppressHydrationWarning>
            <body className="bg-ink-950 text-ink-50 font-sans antialiased ">
                {/* Keyboard and screen-reader users jump past the nav. Visible only on focus. */}
                <a
                    href="#main"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-bookly-emerald-600 focus:px-4 focus:py-2 focus:text-on-accent focus:outline-none"
                >
                    Skip to content
                </a>
                <Providers>{children}</Providers>
                <GrainOverlay />
                <ServiceWorkerRegistration />
                {PLAUSIBLE_DOMAIN && (
                    <Script defer data-domain={PLAUSIBLE_DOMAIN} src="https://plausible.io/js/script.js" strategy="afterInteractive" />
                )}
            </body>
        </html>
    );
}
