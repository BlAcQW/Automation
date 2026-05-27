'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard, Package, ShoppingCart, Calendar, Scissors,
    MessageCircle, Settings,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

interface Tab {
    name: string;
    href: string;
    icon: typeof LayoutDashboard;
}

// PRODUCT-store tenants: Overview · Products · Orders · Chats · Settings
const productTabs: Tab[] = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Products', href: '/products', icon: Package },
    { name: 'Orders', href: '/orders', icon: ShoppingCart },
    { name: 'Chats', href: '/conversations', icon: MessageCircle },
    { name: 'Settings', href: '/settings', icon: Settings },
];

// SERVICE-business tenants: Overview · Bookings · Services · Chats · Settings
const serviceTabs: Tab[] = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Bookings', href: '/bookings', icon: Calendar },
    { name: 'Services', href: '/services', icon: Scissors },
    { name: 'Chats', href: '/conversations', icon: MessageCircle },
    { name: 'Settings', href: '/settings', icon: Settings },
];

/**
 * Floating, WhatsApp-style bottom navigation. Mobile/tablet only
 * (`lg:hidden`); desktop keeps the left sidebar. The tab set adapts to the
 * tenant's businessType. The bar floats with inset margins and clears the
 * iPhone home indicator via `env(safe-area-inset-bottom)`.
 */
export function BottomTabBar() {
    const pathname = usePathname();
    const { tenant } = useAuth();
    const tabs = tenant?.businessType === 'PRODUCT' ? productTabs : serviceTabs;

    return (
        <nav
            className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-3 pointer-events-none
                       pb-[max(0.6rem,env(safe-area-inset-bottom))]"
        >
            <div
                className="pointer-events-auto mx-auto max-w-md grid grid-cols-5
                           rounded-2xl border border-ink-700
                           bg-ink-900/90 backdrop-blur-xl shadow-card-lg"
            >
                {tabs.map((tab) => {
                    const active =
                        pathname === tab.href ||
                        (tab.href !== '/dashboard' && pathname.startsWith(tab.href));
                    const Icon = tab.icon;
                    return (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            className="flex flex-col items-center gap-1 py-2"
                        >
                            <span
                                className={cn(
                                    'flex items-center justify-center rounded-full transition-all duration-200',
                                    active
                                        ? 'h-9 w-9 bg-gradient-to-br from-bookly-emerald-500 to-bookly-emerald-600 text-ink-1000 shadow-md shadow-bookly-emerald-500/30'
                                        : 'h-9 w-9 text-ink-300',
                                )}
                            >
                                <Icon className="w-5 h-5" />
                            </span>
                            <span
                                className={cn(
                                    'text-[10px] font-medium leading-none transition-colors',
                                    active
                                        ? 'text-bookly-emerald-400'
                                        : 'text-ink-300',
                                )}
                            >
                                {tab.name}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
