'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { cn, Avatar } from '@bookingflow/ui';
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
    ChevronRight, Share2, Wallet, CalendarCheck
} from 'lucide-react';

const serviceNavigation = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Availability', href: '/availability', icon: Clock },
    { name: 'Conversations', href: '/conversations', icon: MessageCircle },
    { name: 'Channels', href: '/channels', icon: Share2 },
    { name: 'Money', href: '/money', icon: Wallet },
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
    { name: 'Channels', href: '/channels', icon: Share2 },
    { name: 'Money', href: '/money', icon: Wallet },
    { name: 'Templates', href: '/templates', icon: FileText },
    { name: 'Settings', href: '/settings', icon: Settings },
];

/** OWNER → Owner, STAFF → Staff: sentence case, no tracked caps. */
function formatRole(role?: string | null) {
    if (!role) return '';
    const words = role.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// Cream-on-forest focus: the theme ring (forest brand) would vanish on the frame.
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-glow';

/**
 * Desktop-only left sidebar (`lg+`). On mobile/tablet the navigation is the
 * fixed BottomTabBar instead — there is no hamburger drawer anymore.
 *
 * Forest ledger: the sidebar IS the forest frame (deeper night in dark mode),
 * cream type, a paper logo pill, dark forest-card panels and a gold marker on
 * the active item.
 */
export function Sidebar() {
    const pathname = usePathname();
    const { tenant, user, logout } = useAuth();

    const navigation = tenant?.businessType === 'PRODUCT' ? productNavigation : serviceNavigation;

    return (
        <aside className={cn(
            'hidden lg:flex fixed top-0 bottom-0 left-0 w-60 z-50',
            'bg-forest-frame dark:bg-ink-1000 text-forest-cream',
            'flex-col',
        )}>
            {/* Logo — the marketing site's paper pill with the calendar mark */}
            <div className="h-16 flex items-center px-3 pt-2">
                <Link
                    href="/dashboard"
                    aria-label="Bookly overview"
                    className={cn('fs-logo-pill pr-3 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.5)]', FOCUS)}
                >
                    <span className="fs-logo">
                        <span className="fs-logo-mark" aria-hidden>
                            <CalendarCheck className="h-3 w-3" strokeWidth={2.4} />
                        </span>
                        <span>
                            Bookly<span className="fs-logo-dot">.</span>
                        </span>
                    </span>
                </Link>
            </div>

            {/* Tenant Info */}
            <div className="px-3 pt-3 pb-4">
                <div className="rounded-xl bg-forest-card px-3.5 py-3 shadow-[0_20px_36px_-24px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)] dark:shadow-[0_0_0_1px_rgba(236,235,225,0.06)]">
                    <p className="font-mono text-[11px] text-forest-cream/50">
                        /{tenant?.businessType === 'PRODUCT' ? 'product store' : 'service business'}/
                    </p>
                    <p className="mt-1 truncate text-[15px] font-medium tracking-[-0.02em] text-forest-cream">{tenant?.name}</p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-1 space-y-0.5 overflow-y-auto">
                {navigation.map((item) => {
                    const isActive = pathname === item.href ||
                        (item.href !== '/dashboard' && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                                'relative flex items-center pl-4 pr-3 py-2.5 rounded-lg text-[14px] font-medium tracking-[-0.01em] transition-colors duration-150 group',
                                isActive
                                    ? 'text-forest-cream bg-white/[0.08]'
                                    : 'text-forest-cream/60 hover:text-forest-cream hover:bg-white/[0.04]',
                                FOCUS,
                            )}
                        >
                            {/* Active marker — a small gold tick, shared layoutId so it slides */}
                            {isActive && (
                                <motion.div
                                    layoutId="sidebar-active"
                                    className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-forest-glow rounded-full"
                                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                                />
                            )}

                            <item.icon
                                strokeWidth={isActive ? 2 : 1.75}
                                className={cn(
                                    'w-[18px] h-[18px] mr-3 transition-colors',
                                    isActive ? 'text-forest-cream' : 'text-forest-cream/55 group-hover:text-forest-cream/85',
                                )}
                            />
                            {item.name}

                            {isActive && (
                                <ChevronRight className="w-4 h-4 ml-auto text-forest-cream/40" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Plan details — taken from /billing/status */}
            <div className="px-3">
                <PlanCard />
            </div>

            {/* User & Logout */}
            <div className="p-3 pt-4 border-t border-white/[0.08] mt-3">
                <div className="flex items-center gap-3 px-2 mb-2">
                    <Avatar name={user?.name} size="sm" />
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium tracking-[-0.01em] text-forest-cream truncate">{user?.name}</p>
                        <p className="text-[12px] text-forest-cream/50 truncate">{formatRole(user?.role)}</p>
                    </div>
                </div>
                <button
                    onClick={() => logout()}
                    className={cn(
                        'flex items-center w-full min-h-[44px] px-3 rounded-lg text-[14px] font-medium text-forest-cream/60 hover:bg-[#B03A2E]/25 hover:text-[#F3C9C2] transition-colors duration-150',
                        FOCUS,
                    )}
                >
                    <LogOut className="w-[18px] h-[18px] mr-3" />
                    Sign out
                </button>
            </div>
        </aside>
    );
}
