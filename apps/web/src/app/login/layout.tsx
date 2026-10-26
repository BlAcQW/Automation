import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Log in',
    description: 'Log in to Bookly to see your WhatsApp bookings, orders, chats and payments.',
    alternates: { canonical: '/login' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
