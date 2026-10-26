import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Admin log in',
    description: 'Bookly platform admin.',
    robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
