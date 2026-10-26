import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Get set up',
    description: 'Three quick steps to get your Bookly shop open on WhatsApp.',
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
