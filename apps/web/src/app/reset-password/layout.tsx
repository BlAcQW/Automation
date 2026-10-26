import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Choose a new password',
    description: 'Choose a new password for your Bookly account.',
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
