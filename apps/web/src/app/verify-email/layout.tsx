import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Confirm your email',
    description: 'Confirm the email address on your Bookly account.',
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
