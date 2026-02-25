'use client';

import { DashboardShell } from '@/components/dashboard/shell';

export default function OrdersLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DashboardShell>{children}</DashboardShell>;
}
