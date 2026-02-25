'use client';

import { useAuth } from '@/lib/auth';
import { useSidebar } from './sidebar-context';
import { Avatar } from '@/components/ui/avatar';
import { Menu, Search } from 'lucide-react';
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
                >
                    <Menu className="w-5 h-5" />
                </button>

                {/* Search bar */}
                <div className="hidden md:flex items-center">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search..."
                            className="w-64 pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                        />
                    </div>
                </div>
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
