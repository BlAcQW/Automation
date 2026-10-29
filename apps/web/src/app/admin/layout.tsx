'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { adminApi } from '@/lib/api';
import { Receipt, Menu, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import clsx from 'clsx';
import {
    LayoutDashboard,
    Building2,
    Users,
    Calendar,
    UserCog,
    BarChart3,
    LogOut,
    Ticket,
    KeyRound,
    Bell,
    Wallet,
    Activity,
    Workflow,
    ScrollText,
    Siren,
    ListChecks,
} from 'lucide-react';
import { BrandLogo, Button, Drawer, Skeleton, SkeletonCard } from '@bookingflow/ui';
import { AdminContext, type Admin } from './admin-context';
import { ROLE_LABEL } from './_components/format';

/**
 * Sidebar entries, each tied to the permission the page's API needs. The menu
 * is a convenience: hiding an entry is NOT the access control, the API refuses
 * the request anyway (services/admin-permissions.ts is the single role map).
 */
const navigation = [
    { name: 'Overview', href: '/admin', icon: LayoutDashboard, permission: 'attention:read' },
    { name: 'Businesses', href: '/admin/tenants', icon: Building2, permission: 'tenants:read' },
    { name: 'Waitlist', href: '/admin/waitlist', icon: ListChecks, permission: 'waitlist:read' },
    { name: 'Users', href: '/admin/users', icon: Users, permission: 'users:read' },
    { name: 'Bookings', href: '/admin/bookings', icon: Calendar, permission: 'bookings:read' },
    { name: 'Statistics', href: '/admin/stats', icon: BarChart3, permission: 'stats:read' },
    { name: 'Alerts', href: '/admin/alerts', icon: Bell, permission: 'alerts:read' },
    { name: 'Money', href: '/admin/money', icon: Wallet, permission: 'money:read' },
    { name: 'Messaging health', href: '/admin/messaging', icon: Activity, permission: 'messaging:read' },
    { name: 'Workflows', href: '/admin/flows', icon: Workflow, permission: 'flows:read' },
    { name: 'Audit log', href: '/admin/audit', icon: ScrollText, permission: 'audit:read' },
    { name: 'Safety switches', href: '/admin/safety', icon: Siren, permission: 'attention:read' },
    { name: 'Promo codes', href: '/admin/promo-codes', icon: Ticket, permission: 'promos:read' },
    { name: 'Billing', href: '/admin/billing', icon: Receipt, permission: 'billing:read' },
    { name: 'Manage admins', href: '/admin/admins', icon: UserCog, permission: 'admins:manage' },
    { name: 'My account', href: '/admin/account', icon: KeyRound, permission: 'self' },
];

type NavItem = (typeof navigation)[number];

function AdminNav({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
    return (
        <nav aria-label="Admin" className="space-y-1">
            {items.map((item) => {
                const isActive = pathname === item.href ||
                    (item.href !== '/admin' && pathname.startsWith(item.href));
                return (
                    <Link
                        key={item.name}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? 'page' : undefined}
                        className={clsx(
                            'relative flex min-h-[44px] items-center gap-3 rounded-control px-3 text-[15px] font-medium transition-colors duration-ui',
                            isActive
                                ? 'bg-primary-soft text-primary before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-full before:bg-accent'
                                : 'text-muted hover:bg-surface-2 hover:text-text'
                        )}
                    >
                        <item.icon className="h-5 w-5 shrink-0" aria-hidden />
                        {item.name}
                    </Link>
                );
            })}
        </nav>
    );
}

function AdminIdentity({ admin }: { admin: Admin }) {
    return (
        <div className="rounded-control bg-surface-2 px-3 py-2.5">
            <p className="text-[13px] text-muted">Signed in as</p>
            <p className="truncate font-semibold text-text">{admin.name}</p>
            <span className="mt-1 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-[13px] font-medium text-primary">
                {ROLE_LABEL[admin.role] ?? admin.role}
            </span>
        </div>
    );
}

function SignOutButton({ onClick }: { onClick: () => void }) {
    return (
        <Button variant="ghost" fullWidth onClick={onClick} className="justify-start text-muted hover:bg-error-soft hover:text-error-fg">
            <LogOut className="h-5 w-5" aria-hidden />
            Sign out
        </Button>
    );
}

function AdminLogo() {
    return (
        <Link href="/admin" className="flex items-center gap-2.5 rounded-control">
            <BrandLogo size="sm" />
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[13px] font-semibold text-primary">Admin</span>
        </Link>
    );
}

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [admin, setAdmin] = useState<Admin | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);

    const fetchAdmin = useCallback(async () => {
        try {
            const token = localStorage.getItem('adminAccessToken');
            if (!token) {
                setIsLoading(false);
                return;
            }

            // A 401 here triggers the api-client's refresh (cookie) and one retry, so a
            // 15-minute-old access token no longer ends the session.
            const response = await adminApi.get('/admin/auth/me');
            setAdmin(response.data);
        } catch (error) {
            localStorage.removeItem('adminAccessToken');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAdmin();
    }, [fetchAdmin]);

    useEffect(() => {
        if (!isLoading && !admin && pathname !== '/admin/login') {
            router.push('/admin/login');
        }
    }, [isLoading, admin, pathname, router]);

    const logout = () => {
        // Clear the refresh cookie and revoke it server-side; do not wait on it.
        adminApi.post('/admin/auth/logout').catch(() => undefined);
        localStorage.removeItem('adminAccessToken');
        document.cookie = 'adminAccessToken=; path=/; max-age=0; samesite=lax';
        setAdmin(null);
        router.push('/admin/login');
    };

    // Show login page without layout
    if (pathname === '/admin/login') {
        return children;
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="min-h-screen bg-bg text-text" aria-busy="true">
                <span className="sr-only">Loading the admin console…</span>
                <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface p-4 lg:block">
                    <Skeleton className="h-8 w-28" />
                    <div className="mt-8 space-y-3">
                        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-control" />)}
                    </div>
                </div>
                <div className="space-y-6 px-4 py-6 lg:ml-64 lg:p-8">
                    <Skeleton className="h-10 w-64" />
                    <div className="grid gap-4 md:grid-cols-2">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                </div>
            </div>
        );
    }

    // Not authenticated
    if (!admin) {
        return null;
    }

    const can = (permission: string) => permission === 'self' || admin.permissions.includes(permission);
    const allNavigation = navigation.filter((item) => can(item.permission));
    // The platform requires 2FA and this admin has none: the API only lets them
    // reach their own account until they set it up.
    const mustEnrol = admin.twoFactorRequired && !admin.totpEnabled;

    return (
        <AdminContext.Provider value={{ admin, isLoading, logout, can, reload: fetchAdmin }}>
            {/* The console follows the app theme (cream by default, charcoal in dark):
                every colour below is a semantic token. */}
            <div className="min-h-screen bg-bg text-text">
                {/* Desktop sidebar */}
                <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
                    <div className="flex h-16 items-center border-b border-border px-5">
                        <AdminLogo />
                    </div>
                    <div className="border-b border-border px-4 py-4">
                        <AdminIdentity admin={admin} />
                    </div>
                    <div className="flex-1 overflow-y-auto px-3 py-4">
                        <AdminNav items={allNavigation} pathname={pathname} />
                    </div>
                    <div className="border-t border-border p-3">
                        <SignOutButton onClick={logout} />
                    </div>
                </aside>

                {/* Mobile top bar */}
                <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
                    <AdminLogo />
                    <Button variant="ghost" size="icon" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
                        <Menu className="h-5 w-5" aria-hidden />
                    </Button>
                </header>

                <Drawer isOpen={menuOpen} onClose={() => setMenuOpen(false)} title="Admin menu" side="left">
                    <div className="space-y-4">
                        <AdminIdentity admin={admin} />
                        <AdminNav items={allNavigation} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
                        <div className="border-t border-border pt-3">
                            <SignOutButton onClick={logout} />
                        </div>
                    </div>
                </Drawer>

                {/* Content */}
                <main className="min-w-0 px-4 py-6 lg:ml-64 lg:p-8">
                    {mustEnrol && (
                        <div role="status" className="mb-6 flex items-start gap-3 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-[15px] text-warning-fg">
                            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                            <p>
                                Every admin needs two-step sign-in. Set it up under{' '}
                                <Link href="/admin/account" className="font-semibold underline">My account</Link>;
                                until then, the rest of the console stays locked.
                            </p>
                        </div>
                    )}
                    {children}
                </main>
            </div>
        </AdminContext.Provider>
    );
}
