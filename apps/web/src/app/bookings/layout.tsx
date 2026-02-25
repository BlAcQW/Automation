'use client';

import { DashboardShell } from '@/components/dashboard/shell';

export default function BookingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DashboardShell>{children}</DashboardShell>;
}
