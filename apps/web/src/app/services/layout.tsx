'use client';

import { DashboardShell } from '@/components/dashboard/shell';

export default function ServicesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DashboardShell>{children}</DashboardShell>;
}
