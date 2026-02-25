'use client';

import { ReactNode } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { Sidebar } from './sidebar';
import { DashboardHeader } from './header';
import { SidebarProvider } from './sidebar-context';
import { Loader2 } from 'lucide-react';

interface DashboardShellProps {
    children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
    const { isLoading } = useRequireAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-glow animate-pulse-soft">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <SidebarProvider>
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex">
                <Sidebar />
                <div className="flex-1 flex flex-col lg:ml-64 min-w-0">
                    <DashboardHeader />
                    <main className="flex-1 p-4 lg:p-6 overflow-auto">
                        {children}
                    </main>
                </div>
            </div>
        </SidebarProvider>
    );
}
