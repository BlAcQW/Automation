'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { PlanCard } from './plan-card';
import { motion } from 'framer-motion';
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
    Smartphone,
    FileText,
    ChevronRight,
} from 'lucide-react';

const serviceNavigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Availability', href: '/availability', icon: Clock },
    { name: 'Conversations', href: '/conversations', icon: MessageCircle },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone },
    { name: 'Templates', href: '/templates', icon: FileText },
    { name: 'Settings', href: '/settings', icon: Settings },
];

const productNavigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Products', href: '/products', icon: Package },
    { name: 'Orders', href: '/orders', icon: ShoppingCart },
    { name: 'Inventory', href: '/inventory', icon: Boxes },
    { name: 'Customers', href: '/customers', icon: Users },
    { name: 'Conversations', href: '/conversations', icon: MessageCircle },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone },
    { name: 'Templates', href: '/templates', icon: FileText },
    { name: 'Settings', href: '/settings', icon: Settings },
];

/**
 * Desktop-only left sidebar (`lg+`). On mobile/tablet the navigation is the
 * fixed BottomTabBar instead — there is no hamburger drawer anymore.
 */
export function Sidebar() {
    const pathname = usePathname();
    const { tenant, user, logout } = useAuth();

    const navigation = tenant?.businessType === 'PRODUCT' ? productNavigation : serviceNavigation;

    return (
        <aside className={cn(
            'hidden lg:flex fixed top-0 bottom-0 left-0 w-60 z-50',
            'bg-ink-1000 border-r border-ink-700',
            'flex-col',
        )}>
            {/* Logo */}
            <div className="h-14 flex items-center px-5 border-b border-ink-700">
                <Link href="/dashboard" className="flex items-center gap-1">
                    <span className="font-display font-bold text-h2 tracking-tight text-ink-50">Bookly</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-bookly-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)] mb-1" aria-hidden />
                </Link>
            </div>

            {/* Tenant Info */}
            <div className="px-3 py-4">
                <div className="bg-ink-900 rounded-xl px-3.5 py-2.5 border border-ink-700">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-ink-300">
                        {tenant?.businessType === 'PRODUCT' ? 'Product Store' : 'Service Business'}
                    </p>
                    <p className="font-display font-semibold text-ink-50 truncate text-sm mt-0.5">{tenant?.name}</p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
                {navigation.map((item) => {
                    const isActive = pathname === item.href ||
                        (item.href !== '/dashboard' && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={cn(
                                'relative flex items-center pl-4 pr-3 py-2.5 rounded-xl text-body-sm font-medium transition-all duration-150 group',
                                isActive
                                    ? 'text-ink-50 bg-ink-800'
                                    : 'text-ink-300 hover:text-ink-100 hover:bg-ink-900',
                            )}
                        >
                            {/* Active indicator bar — ui.md §8.1 */}
                            {isActive && (
                                <motion.div
                                    layoutId="sidebar-active"
                                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-bookly-emerald-500 rounded-full"
                                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                                />
                            )}

                            <item.icon className={cn(
                                'w-4.5 h-4.5 mr-3 transition-colors',
                                isActive ? 'text-bookly-emerald-400' : 'text-ink-400 group-hover:text-ink-200',
                            )} />
                            {item.name}

                            {isActive && (
                                <ChevronRight className="w-4 h-4 ml-auto text-bookly-emerald-400/70" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Plan details — taken from /billing/status */}
            <div className="px-4">
                <PlanCard />
            </div>

            {/* User & Logout */}
            <div className="p-4 border-t border-ink-700 mt-3">
                <div className="flex items-center gap-3 px-2 mb-3">
                    <Avatar name={user?.name} size="sm" />
                    <div className="flex-1 min-w-0">
                        <p className="text-body-sm font-medium text-ink-100 truncate">{user?.name}</p>
                        <p className="text-caption uppercase tracking-wider text-ink-400 truncate">{user?.role}</p>
                    </div>
                </div>
                <button
                    onClick={() => logout()}
                    className="flex items-center w-full px-3 py-2.5 rounded-xl text-body-sm font-medium text-ink-400 hover:bg-rose-500/10 hover:text-rose-300 transition-all duration-150"
                >
                    <LogOut className="w-4.5 h-4.5 mr-3" />
                    Sign Out
                </button>
            </div>
        </aside>
    );
}
