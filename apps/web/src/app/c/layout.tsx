import type { Metadata } from 'next';

/** Appointment cancel links are private to one customer: never indexed. */
export const metadata: Metadata = {
    title: 'Your appointment',
    robots: { index: false, follow: false },
};

export default function CancelLinkLayout({ children }: { children: React.ReactNode }) {
    return children;
}
