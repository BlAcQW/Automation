'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { cn } from '@bookingflow/ui';
import { productTabs, serviceTabs, isActivePath } from './nav-items';

/**
 * Mobile/tablet bottom navigation (`lg:hidden`): white bar pinned to the
 * bottom edge, five sections, each target ≥56px tall, green active state
 * with a small gold marker. Clears the iPhone home indicator via
 * `env(safe-area-inset-bottom)`. Desktop uses the sidebar.
 */
export function BottomTabBar() {
    const pathname = usePathname();
    const { tenant } = useAuth();
    const tabs = tenant?.businessType === 'PRODUCT' ? productTabs : serviceTabs;

    return (
        <nav
            aria-label="Main"
            className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-16px_rgb(var(--c-shadow-rgb)/0.25)]"
        >
            <ul className="mx-auto grid max-w-lg grid-cols-5">
                {tabs.map((tab) => {
                    const active = isActivePath(pathname, tab.href);
                    const Icon = tab.icon;
                    return (
                        <li key={tab.href}>
                            <Link
                                href={tab.href}
                                aria-current={active ? 'page' : undefined}
                                className="relative flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 transition-transform active:scale-[0.97]"
                            >
                                {active && <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" />}
                                <span
                                    className={cn(
                                        'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-ui',
                                        active ? 'bg-primary-soft text-primary' : 'text-muted',
                                    )}
                                >
                                    <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                                </span>
                                <span className={cn('text-[12px] leading-none', active ? 'font-semibold text-primary' : 'font-medium text-muted')}>
                                    {tab.name}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
