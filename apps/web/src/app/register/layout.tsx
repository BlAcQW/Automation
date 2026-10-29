import type { Metadata } from 'next';
import { REGISTRATION_OPEN } from '@/lib/feature-flags';

// While sign-up is closed the page only serves invite links: keep it out of search.
export const metadata: Metadata = REGISTRATION_OPEN
    ? {
        title: 'Start free',
        description: 'Create your free Bookly account and take bookings and orders on WhatsApp. 14 days free, no card needed.',
        alternates: { canonical: '/register' },
    }
    : {
        title: 'Create your account',
        description: 'Got a Bookly invite? Create your account and start taking bookings on WhatsApp.',
        alternates: { canonical: '/register' },
        robots: { index: false, follow: true },
    };

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
