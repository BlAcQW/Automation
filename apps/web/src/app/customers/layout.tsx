'use client';

import { DashboardShell } from '@/components/dashboard/shell';

export default function CustomersLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DashboardShell>{children}</DashboardShell>;
}
