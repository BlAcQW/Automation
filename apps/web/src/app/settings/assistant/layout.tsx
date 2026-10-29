import type { Metadata } from 'next';

// The shell comes from app/settings/layout.tsx; this only names the page and
// keeps it out of search, like the other signed-in pages.
export const metadata: Metadata = { title: 'Your assistant', robots: { index: false, follow: false } };

export default function AssistantSettingsLayout({ children }: { children: React.ReactNode }) {
    return children;
}
