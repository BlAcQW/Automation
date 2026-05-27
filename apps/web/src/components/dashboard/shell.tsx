'use client';

import { ReactNode } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { Sidebar } from './sidebar';
import { DashboardHeader } from './header';
import { BottomTabBar } from './bottom-tab-bar';
import { SidebarProvider } from './sidebar-context';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { Loader2 } from 'lucide-react';

interface DashboardShellProps {
    children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
    const { isLoading } = useRequireAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-ink-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-bookly-emerald-400 to-bookly-emerald-600 rounded-xl flex items-center justify-center shadow-bookly-glow animate-pulse-soft">
                        <Loader2 className="w-5 h-5 text-ink-1000 animate-spin" />
                    </div>
                    <p className="text-caption uppercase tracking-wider text-ink-300">Loading…</p>
                </div>
            </div>
        );
    }

    return (
        <SidebarProvider>
            <div className="min-h-screen bg-ink-950 flex">
                <Sidebar />
                <div className="flex-1 flex flex-col lg:ml-60 min-w-0">
                    <DashboardHeader />
                    {/* pb-[7.5rem] on mobile clears the floating bottom tab
                        bar (~73px pill + its own safe-area inset, ~107px on a
                        notched phone); desktop keeps the original padding. */}
                    <main className="flex-1 p-4 pb-[7.5rem] lg:p-6 lg:pb-6 overflow-auto">
                        {children}
                    </main>
                </div>
                {/* WhatsApp-style bottom navigation — mobile/tablet only. */}
                <BottomTabBar />
                {/* PWA install banner — self-hides when installed/dismissed. */}
                <InstallPrompt />
            </div>
        </SidebarProvider>
    );
}
