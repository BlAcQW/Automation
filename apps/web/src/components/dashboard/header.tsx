'use client';

import Link from 'next/link';
import { Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Avatar, AwningDivider, BrandLogo } from '@bookingflow/ui';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { NotificationDropdown } from './notification-dropdown';

/** OWNER → Owner: sentence case instead of tracked caps. */
function formatRole(role?: string | null) {
    if (!role) return '';
    const words = role.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * App header: business name + WhatsApp status (icon + words, never colour
 * alone), search, theme, notifications, account. The gold scalloped awning
 * hangs under it — the Bookly signature, once per screen.
 */
export function DashboardHeader() {
    const { user, tenant } = useAuth();
    const connected = !!tenant?.whatsappConnected;

    return (
        <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur-md pt-[env(safe-area-inset-top)]">
            <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
                <Link href="/dashboard" aria-label="Bookly home" className="rounded-control lg:hidden">
                    <BrandLogo variant="icon" size="sm" labelled={false} />
                </Link>

                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <p className="truncate text-[17px] font-bold text-text">{tenant?.name ?? 'Bookly'}</p>
                    {connected ? (
                        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[13px] font-semibold text-success-fg">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                            WhatsApp connected
                        </span>
                    ) : (
                        <Link
                            href="/whatsapp"
                            className="hidden sm:inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[13px] font-semibold text-warning-fg transition-colors hover:bg-accent/25"
                        >
                            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                            Connect WhatsApp
                        </Link>
                    )}
                </div>

                {/* Search field (visual placeholder until the command palette ships). */}
                <div className="mx-2 hidden max-w-sm flex-1 md:flex">
                    <button
                        type="button"
                        aria-label="Search"
                        className="inline-flex h-11 w-full items-center gap-2 rounded-control border border-border bg-surface px-3.5 text-[15px] text-muted transition-colors hover:border-text/25"
                    >
                        <Search className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="flex-1 text-left">Search…</span>
                        <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-muted">⌘K</kbd>
                    </button>
                </div>

                <div className="ml-auto flex items-center gap-1 sm:gap-2">
                    <ThemeToggle />
                    <NotificationDropdown />
                    <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
                    <div className="flex items-center gap-2 sm:gap-3">
                        <Avatar name={user?.name} size="sm" status="online" />
                        <div className="hidden lg:block">
                            <p className="text-[14px] font-semibold leading-tight text-text">{user?.name}</p>
                            <p className="text-[13px] text-muted">{formatRole(user?.role)}</p>
                        </div>
                    </div>
                </div>
            </div>
            <AwningDivider size="sm" />
        </header>
    );
}
