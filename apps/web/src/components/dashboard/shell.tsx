'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth';
import { cn, PageTransition } from '@bookingflow/ui';
import { Sidebar } from './sidebar';
import { DashboardHeader } from './header';
import { BottomTabBar } from './bottom-tab-bar';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { ShellSkeleton } from './shell-skeleton';
import { InstallPrompt } from '@/components/pwa/install-prompt';

interface DashboardShellProps {
    children: ReactNode;
}

/**
 * Signed-in app frame: desktop sidebar (collapsible), sticky header with
 * the gold awning, mobile bottom tab bar, and a fade + 8px page transition
 * keyed on the route. While auth resolves it shows a skeleton of itself.
 */
export function DashboardShell({ children }: DashboardShellProps) {
    const { isLoading } = useRequireAuth();

    if (isLoading) return <ShellSkeleton />;

    return (
        <SidebarProvider>
            <ShellFrame>{children}</ShellFrame>
        </SidebarProvider>
    );
}

function ShellFrame({ children }: { children: ReactNode }) {
    const { collapsed } = useSidebar();
    const pathname = usePathname();

    return (
        <div className="flex min-h-screen bg-bg">
            <Sidebar />
            <div
                className={cn(
                    'flex min-w-0 flex-1 flex-col transition-[margin] duration-ui-slow ease-brand-out',
                    collapsed ? 'lg:ml-[76px]' : 'lg:ml-64',
                )}
            >
                <DashboardHeader />
                {/* Bottom padding clears the mobile tab bar (60px + safe area). */}
                <main id="main" className="flex-1 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">
                    <PageTransition key={pathname} className="mx-auto w-full max-w-7xl">
                        {children}
                    </PageTransition>
                </main>
            </div>
            <BottomTabBar />
            <InstallPrompt />
        </div>
    );
}
