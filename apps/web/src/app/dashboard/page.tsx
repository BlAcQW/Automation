'use client';

import { useQuery } from '@tanstack/react-query';
import {
    Calendar,
    MessageCircle,
    Users,
    Clock,
    Banknote,
    ShoppingBag,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatMoney, useTenantCurrency } from '@/lib/use-currency';
import { StatCard } from '@/components/ui/stat-card';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { GettingStarted } from '@/components/dashboard/getting-started';

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

export default function DashboardPage() {
    const { tenant } = useAuth();
    const isProduct = tenant?.businessType === 'PRODUCT';
    const currency = useTenantCurrency();

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

    return (
        <div className="space-y-5 sm:space-y-6">
            <GettingStarted />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {statsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
                ) : isProduct ? (
                    <>
                        <StatCard
                            name="Total sales"
                            value={formatMoney(orderStats?.revenue ?? 0, currency)}
                            icon={<Banknote className="w-5 h-5" />}
                            index={0}
                        />
                        <StatCard
                            name="Orders"
                            value={orderStats?.total ?? 0}
                            icon={<ShoppingBag className="w-5 h-5" />}
                            index={1}
                        />
                        <StatCard
                            name="Open chats"
                            value={stats?.activeConversations ?? 0}
                            icon={<MessageCircle className="w-5 h-5" />}
                            index={2}
                        />
                        <StatCard
                            name="Customers"
                            value={stats?.totalCustomers ?? 0}
                            icon={<Users className="w-5 h-5" />}
                            index={3}
                        />
                    </>
                ) : (
                    <>
                        <StatCard
                            name="Bookings today"
                            value={stats?.todayBookings ?? 0}
                            icon={<Clock className="w-5 h-5" />}
                            index={0}
                        />
                        <StatCard
                            name="All bookings"
                            value={stats?.totalBookings ?? 0}
                            icon={<Calendar className="w-5 h-5" />}
                            index={1}
                        />
                        <StatCard
                            name="Open chats"
                            value={stats?.activeConversations ?? 0}
                            icon={<MessageCircle className="w-5 h-5" />}
                            index={2}
                        />
                        <StatCard
                            name="Customers"
                            value={stats?.totalCustomers ?? 0}
                            icon={<Users className="w-5 h-5" />}
                            index={3}
                        />
                    </>
                )}
            </div>

            <RecentActivity />
        </div>
    );
}

/** Same shape as the loaded card, so nothing jumps when the numbers arrive. */
function StatSkeleton() {
    return (
        <div className="rounded-2xl border border-ink-700/70 bg-ink-900 p-4 sm:p-5 animate-pulse" aria-hidden>
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-ink-800" />
            <div className="mt-4 sm:mt-5 h-7 w-16 rounded-md bg-ink-800" />
            <div className="mt-2 h-3.5 w-24 rounded bg-ink-800" />
        </div>
    );
}
