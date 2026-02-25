'use client';

import { DashboardShell } from '@/components/dashboard/shell';

export default function ProductsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DashboardShell>{children}</DashboardShell>;
}
