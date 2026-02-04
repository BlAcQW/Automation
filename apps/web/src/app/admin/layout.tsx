'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { adminApi } from '@/lib/api';
import { Shield } from 'lucide-react';
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
} from 'lucide-react';

interface Admin {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
}

interface AdminContextType {
    admin: Admin | null;
    isLoading: boolean;
    logout: () => void;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

function useAdmin() {
    const context = useContext(AdminContext);
    if (!context) {
        throw new Error('useAdmin must be used within AdminLayout');
    }
    return context;
}

const navigation = [
    { name: 'Overview', href: '/admin', icon: LayoutDashboard },
    { name: 'Tenants', href: '/admin/tenants', icon: Building2 },
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Bookings', href: '/admin/bookings', icon: Calendar },
    { name: 'Statistics', href: '/admin/stats', icon: BarChart3 },
];

const superAdminNavigation = [
    { name: 'Manage Admins', href: '/admin/admins', icon: UserCog },
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
        localStorage.removeItem('adminAccessToken');
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
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
            </div>
        );
    }

    // Not authenticated
    if (!admin) {
        return null;
    }

    const allNavigation = admin.isSuperAdmin
        ? [...navigation, ...superAdminNavigation]
        : navigation;

    return (
        <AdminContext.Provider value={{ admin, isLoading, logout }}>
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
                            {admin.isSuperAdmin && (
                                <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                                    Super Admin
                                </span>
                            )}
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
                    {children}
                </main>
            </div>
        </AdminContext.Provider>
    );
}

export { useAdmin };
