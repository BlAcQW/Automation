'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, Avatar, BrandLogo } from '@bookingflow/ui';
import { PlanCard } from './plan-card';
import { useSidebar } from './sidebar-context';
import { productNavigation, serviceNavigation, isActivePath } from './nav-items';

/** OWNER → Owner, STAFF → Staff: sentence case, no tracked caps. */
function formatRole(role?: string | null) {
    if (!role) return '';
    const words = role.replace(/_/g, ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Desktop sidebar (`lg+`): white panel on the cream page, BrandLogo on top,
 * green active item, plan card and account at the foot. Collapses to a
 * 76px icon rail (labels become tooltips via aria-label/title). Mobile
 * uses the BottomTabBar instead.
 */
export function Sidebar() {
    const pathname = usePathname();
    const { tenant, user, logout } = useAuth();
    const { collapsed, toggleCollapsed } = useSidebar();
    const reduce = useReducedMotion();
    const navigation = tenant?.businessType === 'PRODUCT' ? productNavigation : serviceNavigation;

    return (
        <aside
            className={cn(
                'hidden lg:flex fixed inset-y-0 left-0 z-40 flex-col border-r border-border bg-surface transition-[width] duration-ui-slow ease-brand-out',
                collapsed ? 'w-[76px]' : 'w-64',
            )}
            aria-label="Main"
        >
            <div className={cn('flex h-16 items-center', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
                <Link href="/dashboard" aria-label="Bookly home" className="rounded-control">
                    <BrandLogo variant={collapsed ? 'icon' : 'lockup'} size="sm" labelled={false} />
                </Link>
                {!collapsed && (
                    <button
                        type="button"
                        onClick={toggleCollapsed}
                        aria-label="Collapse sidebar"
                        className="flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-text"
                    >
                        <PanelLeftClose className="h-5 w-5" />
                    </button>
                )}
            </div>

            {!collapsed && tenant?.name && (
                <div className="mx-4 mb-3 rounded-control bg-surface-2 px-3 py-2.5">
                    <p className="text-[13px] text-muted">{tenant.businessType === 'PRODUCT' ? 'Your shop' : 'Your business'}</p>
                    <p className="truncate text-[15px] font-semibold text-text">{tenant.name}</p>
                </div>
            )}

            <nav className={cn('flex-1 space-y-1 overflow-y-auto py-1', collapsed ? 'px-3' : 'px-3')}>
                {navigation.map((item) => {
                    const active = isActivePath(pathname, item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            aria-label={collapsed ? item.name : undefined}
                            title={collapsed ? item.name : undefined}
                            className={cn(
                                'group relative flex min-h-[44px] items-center gap-3 rounded-control text-[15px] font-medium transition-colors duration-ui',
                                collapsed ? 'justify-center px-0' : 'px-3',
                                active ? 'text-primary' : 'text-muted hover:bg-surface-2 hover:text-text',
                            )}
                        >
                            {active && (
                                <motion.span
                                    layoutId={reduce ? undefined : 'sidebar-active'}
                                    className="absolute inset-0 rounded-control bg-primary-soft"
                                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                    aria-hidden
                                />
                            )}
                            <item.icon className="relative h-5 w-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                            {!collapsed && <span className="relative truncate">{item.name}</span>}
                            {active && !collapsed && (
                                <span className="relative ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                            )}
                        </Link>
                    );
                })}
            </nav>

            {!collapsed && (
                <div className="px-3 pt-2">
                    <PlanCard />
                </div>
            )}

            <div className={cn('mt-3 border-t border-border p-3', collapsed && 'flex flex-col items-center gap-1')}>
                {collapsed ? (
                    <>
                        <button
                            type="button"
                            onClick={toggleCollapsed}
                            aria-label="Expand sidebar"
                            title="Expand sidebar"
                            className="flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-text"
                        >
                            <PanelLeftOpen className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => logout()}
                            aria-label="Sign out"
                            title="Sign out"
                            className="flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-error-soft hover:text-error-fg"
                        >
                            <LogOut className="h-5 w-5" />
                        </button>
                    </>
                ) : (
                    <>
                        <div className="mb-1 flex items-center gap-3 px-2 py-1">
                            <Avatar name={user?.name} size="sm" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[14px] font-semibold text-text">{user?.name}</p>
                                <p className="truncate text-[13px] text-muted">{formatRole(user?.role)}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => logout()}
                            className="flex min-h-[44px] w-full items-center gap-3 rounded-control px-3 text-[15px] font-medium text-muted transition-colors hover:bg-error-soft hover:text-error-fg"
                        >
                            <LogOut className="h-5 w-5" aria-hidden />
                            Sign out
                        </button>
                    </>
                )}
            </div>
        </aside>
    );
}
