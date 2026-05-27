import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import { GrainOverlay } from '@/components/primitives/grain-overlay';

// Geist + Geist Mono — Vercel's open-source typeface, same family that Vapi,
// Linear, Cal.com and the rest of the dev-tool A-list use. Loaded via
// Google Fonts CSS in globals.css (Next 14.1's `next/font/google` predates
// Geist's typed export). The `--font-sans` / `--font-mono` CSS vars are
// defined in globals.css and resolved by tailwind.config.ts.

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#FAFBFA' },
        { media: '(prefers-color-scheme: dark)', color: '#0A0F0D' },
    ],
};

export const metadata: Metadata = {
    title: 'Bookly — WhatsApp-first SaaS for small businesses',
    description: 'Your customers chat. A bot handles bookings, payments, reminders, and FAQs. You run everything from one cinematic dashboard.',
    keywords: ['whatsapp', 'automation', 'bookings', 'crm', 'small business', 'saas', 'bot'],
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
        // Dark mode is the Bookly default per ui.md §6.2. next-themes toggles
        // a `dark`/`light` class on <html> at runtime; `suppressHydrationWarning`
        // is required because the class is set before hydration.
        <html lang="en" suppressHydrationWarning>
            <body className="bg-ink-950 text-ink-50 font-sans antialiased selection:bg-bookly-emerald-500/30 selection:text-ink-50">
                <Providers>{children}</Providers>
                <GrainOverlay />
                <ServiceWorkerRegistration />
            </body>
        </html>
    );
}
