'use client';

import { useAuth } from '@/lib/auth';
import { Bell, User } from 'lucide-react';

export function DashboardHeader() {
    const { user } = useAuth();

    return (
        <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6">
            <div>
                {/* Breadcrumb or page title could go here */}
            </div>

            <div className="flex items-center space-x-4">
                {/* Notifications */}
                <button className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary-500 rounded-full" />
                </button>

                {/* User Menu */}
                <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 gradient-primary rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-white" />
                    </div>
                    <div className="hidden sm:block">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{user?.role}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
