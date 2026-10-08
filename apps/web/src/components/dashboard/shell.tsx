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
                    <div className="w-10 h-10 bg-forest-brand rounded flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
                        <Loader2 className="w-5 h-5 text-on-accent animate-spin" />
                    </div>
                    <p className="text-sm text-ink-300">Loading your workspace</p>
                </div>
            </div>
        );
    }

    return (
        <SidebarProvider>
            {/* Forest frame: on desktop the sidebar and an 8px gutter share the
                frame colour and the paper canvas sits inset with soft corners,
                like the reference's framed page. `overflow-clip` (not hidden)
                rounds the canvas without breaking the sticky header. */}
            <div className="min-h-screen bg-ink-950 lg:bg-forest-frame dark:lg:bg-ink-1000 flex">
                <Sidebar />
                <div className="flex-1 flex flex-col lg:ml-60 min-w-0 bg-ink-950 lg:my-2 lg:mr-2 lg:rounded-3xl lg:overflow-clip lg:shadow-[0_30px_60px_-40px_rgba(0,0,0,0.6)] dark:lg:shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.06)]">
                    <DashboardHeader />
                    {/* pb-[7.5rem] on mobile clears the floating bottom tab
                        bar (~73px pill + its own safe-area inset, ~107px on a
                        notched phone); desktop keeps the original padding. */}
                    <main id="main" className="flex-1 p-4 pb-[7.5rem] lg:p-8 lg:pb-8 overflow-auto">
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
