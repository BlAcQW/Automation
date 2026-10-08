'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard, Package, ShoppingCart, Calendar, Scissors,
    MessageCircle, Settings,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@bookingflow/ui';

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
            {/* Dark night bar in both themes: the forest frame, floating. */}
            <div
                className="pointer-events-auto mx-auto max-w-md grid grid-cols-5
                           rounded-3xl bg-forest-night/95 dark:bg-ink-1000/95 backdrop-blur-md
                           shadow-[0_24px_40px_-20px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.06)]
                           dark:shadow-[0_0_0_1px_rgba(236,235,225,0.08),0_24px_40px_-20px_rgba(0,0,0,0.8)]"
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
                            aria-current={active ? 'page' : undefined}
                            className="relative flex min-h-[56px] flex-col items-center justify-center gap-1 py-1.5 rounded-3xl active:scale-[0.97] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-forest-glow"
                        >
                            <span
                                className={cn(
                                    'flex h-8 w-12 items-center justify-center rounded-lg transition-colors duration-200',
                                    active
                                        ? 'bg-white/[0.08] text-forest-cream'
                                        : 'text-forest-cream/55',
                                )}
                            >
                                <Icon className="w-5 h-5" strokeWidth={active ? 2.1 : 1.75} />
                            </span>
                            <span
                                className={cn(
                                    'text-[11px] leading-none tracking-[-0.01em] transition-colors',
                                    active
                                        ? 'font-medium text-forest-cream'
                                        : 'font-normal text-forest-cream/55',
                                )}
                            >
                                {tab.name}
                            </span>
                            {active && (
                                <span
                                    aria-hidden
                                    className="absolute bottom-1 h-1 w-1 rounded-full bg-forest-glow"
                                />
                            )}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
