import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Start free',
    description: 'Create your free Bookly account and take bookings and orders on WhatsApp. 14 days free, no card needed.',
    alternates: { canonical: '/register' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
