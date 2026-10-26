import type { Metadata } from 'next';

/** Order tracking links are private to one customer: never indexed. */
export const metadata: Metadata = {
    title: 'Track your order',
    robots: { index: false, follow: false },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
    return children;
}
