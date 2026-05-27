'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui/avatar';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { NotificationDropdown } from './notification-dropdown';

export function DashboardHeader() {
    const { user, tenant } = useAuth();
    const connected = !!tenant?.whatsappConnected;

    return (
        <header className="h-14 bg-ink-950/80 backdrop-blur-xl border-b border-ink-700 flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-30">
            {/* Left: business name + WhatsApp connection status */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <p className="font-display font-semibold text-ink-50 truncate text-h3">
                    {tenant?.name ?? 'Bookly'}
                </p>
                {connected ? (
                    <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[var(--wa-green)]/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--wa-green)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--wa-green)] animate-pulse" />
                        WhatsApp Connected
                    </span>
                ) : (
                    <Link
                        href="/whatsapp"
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300 hover:bg-amber-500/25"
                    >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Connect WhatsApp
                    </Link>
                )}
            </div>

            {/* Center: command-palette pill (visual placeholder — ui.md §8.1). */}
            <div className="hidden md:flex flex-1 max-w-sm mx-2">
                <button
                    type="button"
                    className="w-full h-9 inline-flex items-center gap-2 px-3 rounded-full bg-ink-900 border border-ink-700 text-body-sm text-ink-300 hover:bg-ink-800 transition-colors"
                >
                    <Search className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left">Search…</span>
                    <kbd className="font-mono text-[10px] uppercase text-ink-400 border border-ink-700 rounded px-1.5 py-0.5">⌘K</kbd>
                </button>
            </div>

            {/* Right: theme, notifications, user. */}
            <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                <ThemeToggle />
                <NotificationDropdown />
                <div className="hidden sm:block w-px h-7 bg-ink-700 mx-1" />
                <div className="flex items-center gap-2 sm:gap-3">
                    <Avatar name={user?.name} size="sm" status="online" />
                    <div className="hidden lg:block">
                        <p className="text-body-sm font-semibold text-ink-50 leading-tight">{user?.name}</p>
                        <p className="text-caption uppercase tracking-wider text-ink-300">{user?.role}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
