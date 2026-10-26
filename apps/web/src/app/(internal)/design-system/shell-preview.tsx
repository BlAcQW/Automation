'use client';

import { Sidebar } from '@/components/dashboard/sidebar';
import { DashboardHeader } from '@/components/dashboard/header';
import { BottomTabBar } from '@/components/dashboard/bottom-tab-bar';
import { SidebarProvider } from '@/components/dashboard/sidebar-context';
import { PageHeader, SkeletonCard } from '@bookingflow/ui';

/**
 * The real shell parts inside a framed box. `transform` makes the frame the
 * containing block for the shell's `position: fixed` pieces, so they render
 * inside the preview instead of over the page.
 */
export function ShellPreview() {
    return (
        <SidebarProvider>
            <div
                className="relative h-[560px] overflow-hidden rounded-card-lg border border-border bg-bg shadow-card-lg"
                style={{ transform: 'translateZ(0)' }}
            >
                <Sidebar />
                <div className="flex h-full flex-col lg:ml-64">
                    <DashboardHeader />
                    <div className="flex-1 space-y-5 overflow-hidden px-4 pt-5 lg:px-8">
                        <PageHeader title="Your bookings" subtitle="Everything customers booked on WhatsApp." />
                        <div className="grid gap-4 lg:grid-cols-2">
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                    </div>
                </div>
                <BottomTabBar />
            </div>
        </SidebarProvider>
    );
}
