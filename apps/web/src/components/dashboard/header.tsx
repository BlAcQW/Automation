'use client';

import { useAuth } from '@/lib/auth';
import { useSidebar } from './sidebar-context';
import { Avatar } from '@/components/ui/avatar';
import { Menu } from 'lucide-react';
import { NotificationDropdown } from './notification-dropdown';

export function DashboardHeader() {
    const { user } = useAuth();
    const { toggle } = useSidebar();

    return (
        <header className="h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
            <div className="flex items-center space-x-4">
                {/* Mobile menu button */}
                <button
                    onClick={toggle}
                    className="lg:hidden p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    aria-label="Toggle navigation"
                >
                    <Menu className="w-5 h-5" />
                </button>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-3">
                {/* Notifications */}
                <NotificationDropdown />

                {/* Divider */}
                <div className="hidden sm:block w-px h-8 bg-slate-200 dark:bg-slate-700" />

                {/* User Menu */}
                <div className="flex items-center space-x-3">
                    <Avatar name={user?.name} size="sm" status="online" />
                    <div className="hidden sm:block">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{user?.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{user?.role}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
