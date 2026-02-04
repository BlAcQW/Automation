'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import clsx from 'clsx';
import {
    MessageSquare,
    LayoutDashboard,
    Calendar,
    Scissors,
    Clock,
    MessageCircle,
    Settings,
    LogOut,
    Package,
    ShoppingCart,
    Users,
    Boxes,
} from 'lucide-react';

// Service business navigation
const serviceNavigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Availability', href: '/availability', icon: Clock },
    { name: 'Conversations', href: '/conversations', icon: MessageCircle },
    { name: 'Settings', href: '/settings', icon: Settings },
];

// Product business navigation
const productNavigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Products', href: '/products', icon: Package },
    { name: 'Orders', href: '/orders', icon: ShoppingCart },
    { name: 'Inventory', href: '/inventory', icon: Boxes },
    { name: 'Customers', href: '/customers', icon: Users },
    { name: 'Conversations', href: '/conversations', icon: MessageCircle },
    { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();
    const { tenant, logout } = useAuth();

    // Select navigation based on business type
    const navigation = tenant?.businessType === 'PRODUCT' ? productNavigation : serviceNavigation;

    return (
        <aside className="fixed left-0 top-0 bottom-0 w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col z-40">
            {/* Logo */}
            <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700">
                <Link href="/dashboard" className="flex items-center space-x-2">
                    <div className="w-8 h-8 gradient-primary rounded-lg flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">BookingFlow</span>
                </Link>
            </div>

            {/* Tenant Info */}
            <div className="px-4 py-4 border-b border-slate-200 dark:border-slate-700">
                <div className="bg-slate-100 dark:bg-slate-700/50 rounded-lg px-3 py-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {tenant?.businessType === 'PRODUCT' ? 'Product Store' : 'Service Business'}
                    </p>
                    <p className="font-medium text-slate-900 dark:text-white truncate">{tenant?.name}</p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
                {navigation.map((item) => {
                    const isActive = pathname === item.href ||
                        (item.href !== '/dashboard' && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={clsx(
                                'flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                                isActive
                                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                            )}
                        >
                            <item.icon className="w-5 h-5 mr-3" />
                            {item.name}
                        </Link>
                    );
                })}
            </nav>

            {/* Logout */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <button
                    onClick={() => logout()}
                    className="flex items-center w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-red-600 dark:hover:text-red-400 transition-all"
                >
                    <LogOut className="w-5 h-5 mr-3" />
                    Sign Out
                </button>
            </div>
        </aside>
    );
}
