import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#0a0f1a' },
    ],
};

export const metadata: Metadata = {
    title: 'BookingFlow - WhatsApp Booking Automation',
    description: 'Automate your appointment bookings via WhatsApp. Smart scheduling, customer management, and real-time conversations.',
    keywords: ['booking', 'whatsapp', 'automation', 'appointments', 'scheduling', 'business'],
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'BookingFlow',
    },
    formatDetection: {
        telephone: false,
    },
    icons: {
        icon: [
            { url: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
            { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        ],
        apple: [
            { url: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
            { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        ],
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
        <html lang="en" suppressHydrationWarning>
            <body className={inter.className}>
                <Providers>{children}</Providers>
                <ServiceWorkerRegistration />
            </body>
        </html>
    );
}
