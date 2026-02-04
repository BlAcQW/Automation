'use client';

import { useRequireAuth } from '@/lib/auth';
import { Sidebar } from '@/components/dashboard/sidebar';
import { DashboardHeader } from '@/components/dashboard/header';

export default function ServicesLayout({ children }: { children: React.ReactNode }) {
    const { isLoading } = useRequireAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            <Sidebar />
            <div className="pl-64">
                <DashboardHeader />
                <main className="p-6">{children}</main>
            </div>
        </div>
    );
}
