import type { Metadata } from 'next';

/** Customer payment results are private links: never indexed. */
export const metadata: Metadata = {
    title: 'Your payment',
    robots: { index: false, follow: false },
};

export default function PayLayout({ children }: { children: React.ReactNode }) {
    return children;
}
