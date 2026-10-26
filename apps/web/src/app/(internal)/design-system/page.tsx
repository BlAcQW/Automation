import type { Metadata } from 'next';
import { DesignSystemShowcase } from './showcase';

// Internal visual check of the Bookly design system (screenshots, QA).
// Not linked from anywhere and never indexed.
export const metadata: Metadata = {
    title: 'Design system',
    robots: { index: false, follow: false, nocache: true },
};

export default function DesignSystemPage() {
    return <DesignSystemShowcase />;
}
