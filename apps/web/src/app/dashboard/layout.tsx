import type { Metadata } from 'next';
import { DashboardShell } from '@/components/dashboard/shell';

// The shell is a client component; this layout stays a server component so it
// can own the page title.
export const metadata: Metadata = { title: 'Overview' };

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DashboardShell>{children}</DashboardShell>;
}
