import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Reset your password',
    description: 'Forgot your Bookly password? We will email you a link to choose a new one.',
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
