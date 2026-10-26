'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
    Calendar,
    MessageCircle,
    Users,
    Clock,
    Banknote,
    ShoppingBag,
    ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/lib/use-currency';
import { PageHeader, StatCard, Skeleton, buttonVariants } from '@bookingflow/ui';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { VerifyEmailBanner } from '@/components/dashboard/verify-email-banner';
import { displayMoney } from '@/components/primitives/money';

interface DashboardStats {
    totalBookings: number;
    todayBookings: number;
    activeConversations: number;
    totalCustomers: number;
}

interface OrderStats {
    total: number;
    pending: number;
    confirmed: number;
    delivered: number;
    revenue: number;
}

/** "Good morning" etc. Worked out after mount so the server and browser clocks never disagree. */
function useGreeting(): string {
    const [greeting, setGreeting] = useState('Welcome back');
    useEffect(() => {
        const hour = new Date().getHours();
        setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
    }, []);
    return greeting;
}

export default function DashboardPage() {
    const { tenant, user } = useAuth();
    const isProduct = tenant?.businessType === 'PRODUCT';
    const currency = useTenantCurrency();
    const greeting = useGreeting();
    const firstName = user?.name?.trim().split(/\s+/)[0];

    const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
        queryKey: ['dashboard', 'stats'],
        queryFn: async () => (await api.get('/dashboard/stats')).data.data,
        refetchInterval: 60_000,
    });

    // Product tenants also get the revenue / order-count metrics from the
    // existing /orders/stats endpoint so the 4-card row stays meaningful.
    const { data: orderStats } = useQuery<OrderStats>({
        queryKey: ['orders', 'stats'],
        queryFn: async () => (await api.get('/orders/stats')).data,
        enabled: isProduct,
        refetchInterval: 60_000,
    });

    const subtitle = isProduct
        ? "Here's how your shop is doing today."
        : "Here's what's happening at your shop today.";

    return (
        <div className="space-y-6 lg:space-y-8">
            <PageHeader
                title={firstName ? `${greeting}, ${firstName}` : greeting}
                subtitle={subtitle}
                actions={
                    <Link
                        href={isProduct ? '/orders' : '/bookings'}
                        className={buttonVariants({ variant: 'secondary' })}
                    >
                        {isProduct ? 'See orders' : 'See bookings'}
                        <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                }
            />

            <VerifyEmailBanner />
            <GettingStarted />

            <section aria-labelledby="today-heading">
                <h2 id="today-heading" className="sr-only">Your numbers</h2>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-busy={statsLoading || undefined}>
                    {statsLoading ? (
                        <>
                            <span className="sr-only">Loading your numbers…</span>
                            {Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)}
                        </>
                    ) : isProduct ? (
                        <>
                            <StatCard
                                name="Sales"
                                value={displayMoney(orderStats?.revenue ?? 0, currency, { compact: true })}
                                icon={<Banknote />}
                                index={0}
                            />
                            <StatCard name="Orders" value={orderStats?.total ?? 0} icon={<ShoppingBag />} index={1} />
                            <StatCard name="Open chats" value={stats?.activeConversations ?? 0} icon={<MessageCircle />} index={2} />
                            <StatCard name="Customers" value={stats?.totalCustomers ?? 0} icon={<Users />} index={3} />
                        </>
                    ) : (
                        <>
                            <StatCard name="Today" value={stats?.todayBookings ?? 0} icon={<Clock />} index={0} />
                            <StatCard name="Bookings" value={stats?.totalBookings ?? 0} icon={<Calendar />} index={1} />
                            <StatCard name="Open chats" value={stats?.activeConversations ?? 0} icon={<MessageCircle />} index={2} />
                            <StatCard name="Customers" value={stats?.totalCustomers ?? 0} icon={<Users />} index={3} />
                        </>
                    )}
                </div>
            </section>

            <RecentActivity />
        </div>
    );
}

/** Same shape as a loaded StatCard, so nothing jumps when the numbers arrive. */
function StatSkeleton() {
    return (
        <div aria-hidden className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
            <div className="flex items-start justify-between gap-2">
                <Skeleton className="mt-1 h-4 w-20" />
                <Skeleton className="h-9 w-9 rounded-control" />
            </div>
            <Skeleton className="mt-4 h-8 w-16 sm:mt-5" />
            <Skeleton className="mt-3 h-[3px] w-8 rounded-full" />
        </div>
    );
}
