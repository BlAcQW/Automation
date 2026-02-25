'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSidebar } from './sidebar-context';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { motion, AnimatePresence } from 'framer-motion';
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
    X,
    ChevronRight,
} from 'lucide-react';

const serviceNavigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Availability', href: '/availability', icon: Clock },
    { name: 'Conversations', href: '/conversations', icon: MessageCircle },
    { name: 'WhatsApp', href: '/whatsapp', icon: Smartphone },
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
    { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();
    const { tenant, user, logout } = useAuth();
    const { isOpen, close } = useSidebar();

    const navigation = tenant?.businessType === 'PRODUCT' ? productNavigation : serviceNavigation;

    return (
        <>
            {/* Mobile overlay */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                        onClick={close}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={cn(
                'fixed top-0 bottom-0 w-64 z-50 transition-transform duration-300 ease-in-out',
                'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-r border-slate-800/80',
                'flex flex-col',
                'lg:left-0 lg:translate-x-0',
                isOpen ? 'left-0 translate-x-0' : '-translate-x-full lg:translate-x-0'
            )}>
                {/* Logo */}
                <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/80">
                    <Link href="/dashboard" className="flex items-center space-x-2.5" onClick={close}>
                        <div className="w-9 h-9 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-glow-sm">
                            <MessageSquare className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-lg font-bold text-white tracking-tight">BookingFlow</span>
                    </Link>
                    <button
                        onClick={close}
                        className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tenant Info */}
                <div className="px-4 py-4">
                    <div className="bg-slate-800/60 rounded-xl px-3.5 py-2.5 border border-slate-700/50">
                        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                            {tenant?.businessType === 'PRODUCT' ? 'Product Store' : 'Service Business'}
                        </p>
                        <p className="font-semibold text-slate-200 truncate text-sm mt-0.5">{tenant?.name}</p>
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
                                onClick={close}
                                className={cn(
                                    'relative flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                                    isActive
                                        ? 'text-white bg-emerald-500/15'
                                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                                )}
                            >
                                {/* Active indicator bar */}
                                {isActive && (
                                    <motion.div
                                        layoutId="sidebar-active"
                                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-gradient-to-b from-emerald-400 to-teal-500 rounded-full"
                                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                                    />
                                )}

                                <item.icon className={cn(
                                    'w-5 h-5 mr-3 transition-colors',
                                    isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-400'
                                )} />
                                {item.name}

                                {isActive && (
                                    <ChevronRight className="w-4 h-4 ml-auto text-emerald-400/60" />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* User & Logout */}
                <div className="p-4 border-t border-slate-800/80">
                    <div className="flex items-center gap-3 px-2 mb-3">
                        <Avatar name={user?.name} size="sm" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
                            <p className="text-xs text-slate-500 truncate">{user?.role}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => logout()}
                        className="flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200"
                    >
                        <LogOut className="w-5 h-5 mr-3" />
                        Sign Out
                    </button>
                </div>
            </aside>
        </>
    );
}
