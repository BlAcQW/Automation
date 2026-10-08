'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@bookingflow/ui';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { NotificationDropdown } from './notification-dropdown';

/** OWNER → Owner: sentence case instead of tracked caps. */
function formatRole(role?: string | null) {
    if (!role) return '';
    const words = role.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export function DashboardHeader() {
    const { user, tenant } = useAuth();
    const connected = !!tenant?.whatsappConnected;

    return (
        // Quiet paper bar: same ground as the canvas, one hairline below.
        <header className="h-14 lg:h-16 bg-ink-950/85 backdrop-blur-md border-b border-ink-50/[0.08] flex items-center gap-3 px-4 lg:px-8 sticky top-0 z-30">
            {/* Left: business name + WhatsApp connection status */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <p className="truncate text-[17px] font-medium tracking-[-0.03em] text-ink-50">
                    {tenant?.name ?? 'Bookly'}
                </p>
                {connected ? (
                    <span className="hidden sm:inline-flex items-center gap-1.5 rounded bg-[var(--wa-green)]/[0.12] px-2 py-[3px] text-[11px] font-medium text-[var(--wa-teal)] dark:text-[var(--wa-green)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--wa-green)] animate-pulse" />
                        WhatsApp connected
                    </span>
                ) : (
                    <Link
                        href="/whatsapp"
                        className="hidden sm:inline-flex items-center gap-1.5 rounded bg-[#F1E3C2] px-2 py-[3px] text-[11px] font-medium text-[#7A5512] hover:bg-[#EAD7AC] dark:bg-forest-glow/15 dark:text-forest-glow dark:hover:bg-forest-glow/25 transition-colors"
                    >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#E0A43A] dark:bg-forest-glow" />
                        Connect WhatsApp
                    </Link>
                )}
            </div>

            {/* Center: command-palette field (visual placeholder — ui.md §8.1). */}
            <div className="hidden md:flex flex-1 max-w-sm mx-2">
                <button
                    type="button"
                    aria-label="Search"
                    className="w-full h-9 inline-flex items-center gap-2 px-3 rounded-lg bg-white dark:bg-ink-1000 shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.1)] text-[13px] text-ink-400 hover:text-ink-300 hover:shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.18)] transition-[box-shadow,color]"
                >
                    <Search className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left">Search…</span>
                    <kbd className="font-mono text-[11px] text-ink-400 bg-ink-900 rounded-sm px-1.5 py-0.5">⌘K</kbd>
                </button>
            </div>

            {/* Right: theme, notifications, user. */}
            <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                <ThemeToggle />
                <NotificationDropdown />
                <div className="hidden sm:block w-px h-6 bg-ink-50/10 mx-1" />
                <div className="flex items-center gap-2 sm:gap-3">
                    <Avatar name={user?.name} size="sm" status="online" />
                    <div className="hidden lg:block">
                        <p className="text-[13px] font-medium tracking-[-0.01em] text-ink-50 leading-tight">{user?.name}</p>
                        <p className="text-[12px] text-ink-400">{formatRole(user?.role)}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
