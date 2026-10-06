'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { adminApi } from '@/lib/api';
import { Shield, Receipt } from 'lucide-react';
import { BooklyDots } from '@/components/primitives/bookly-dots';
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
    MessageSquare,
    Workflow,
    ScrollText,
    Siren,
} from 'lucide-react';
import { AdminContext, type Admin } from './admin-context';
import { ROLE_LABEL } from './_components/format';

/**
 * Sidebar entries, each tied to the permission the page's API needs. The menu
 * is a convenience: hiding an entry is NOT the access control, the API refuses
 * the request anyway (services/admin-permissions.ts is the single role map).
 */
const navigation = [
    { name: 'Overview', href: '/admin', icon: LayoutDashboard, permission: 'attention:read' },
    { name: 'Tenants', href: '/admin/tenants', icon: Building2, permission: 'tenants:read' },
    { name: 'Users', href: '/admin/users', icon: Users, permission: 'users:read' },
    { name: 'Bookings', href: '/admin/bookings', icon: Calendar, permission: 'bookings:read' },
    { name: 'Statistics', href: '/admin/stats', icon: BarChart3, permission: 'stats:read' },
    { name: 'Alerts', href: '/admin/alerts', icon: Bell, permission: 'alerts:read' },
    { name: 'Money', href: '/admin/money', icon: Wallet, permission: 'money:read' },
    { name: 'Messaging health', href: '/admin/messaging', icon: MessageSquare, permission: 'messaging:read' },
    { name: 'Workflows', href: '/admin/flows', icon: Workflow, permission: 'flows:read' },
    { name: 'Audit log', href: '/admin/audit', icon: ScrollText, permission: 'audit:read' },
    { name: 'Safety switches', href: '/admin/safety', icon: Siren, permission: 'attention:read' },
    { name: 'Promo codes', href: '/admin/promo-codes', icon: Ticket, permission: 'promos:read' },
    { name: 'Billing', href: '/admin/billing', icon: Receipt, permission: 'billing:read' },
    { name: 'Manage Admins', href: '/admin/admins', icon: UserCog, permission: 'admins:manage' },
    { name: 'My account', href: '/admin/account', icon: KeyRound, permission: 'self' },
];

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [admin, setAdmin] = useState<Admin | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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
            <div className="min-h-screen bg-ink-950 flex items-center justify-center">
                <BooklyDots size="lg" />
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
            <div className="min-h-screen bg-slate-900 flex">
                {/* Sidebar */}
                <aside className="fixed left-0 top-0 bottom-0 w-64 bg-slate-800 border-r border-slate-700 flex flex-col z-40">
                    {/* Logo */}
                    <div className="h-16 flex items-center px-6 border-b border-slate-700">
                        <Link href="/admin" className="flex items-center space-x-2">
                            <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center">
                                <Shield className="w-5 h-5 text-slate-300" />
                            </div>
                            <span className="text-lg font-bold text-white">Admin Panel</span>
                        </Link>
                    </div>

                    {/* Admin Info */}
                    <div className="px-4 py-4 border-b border-slate-700">
                        <div className="bg-slate-700/50 rounded-lg px-3 py-2">
                            <p className="text-xs text-slate-400">Logged in as</p>
                            <p className="font-medium text-white truncate">{admin.name}</p>
                            <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                                {ROLE_LABEL[admin.role] ?? admin.role}
                            </span>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
                        {allNavigation.map((item) => {
                            const isActive = pathname === item.href ||
                                (item.href !== '/admin' && pathname.startsWith(item.href));

                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    className={clsx(
                                        'flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                                        isActive
                                            ? 'bg-slate-700 text-white'
                                            : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
                                    )}
                                >
                                    <item.icon className="w-5 h-5 mr-3" />
                                    {item.name}
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Logout */}
                    <div className="p-4 border-t border-slate-700">
                        <button
                            onClick={logout}
                            className="flex items-center w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-700/50 hover:text-red-400 transition-all"
                        >
                            <LogOut className="w-5 h-5 mr-3" />
                            Sign Out
                        </button>
                    </div>
                </aside>

                {/* Content */}
                <main className="flex-1 ml-64 p-8">
                    {mustEnrol && (
                        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                            Two-factor sign-in is required for all admins. Until you set it up under{' '}
                            <Link href="/admin/account" className="font-semibold underline">My account</Link>,
                            the rest of the console is locked.
                        </div>
                    )}
                    {children}
                </main>
            </div>
        </AdminContext.Provider>
    );
}
