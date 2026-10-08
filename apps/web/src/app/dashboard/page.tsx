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
import { StatCard } from '@bookingflow/ui';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { VerifyEmailBanner } from '@/components/dashboard/verify-email-banner';

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
        <div className="space-y-5 sm:space-y-6 lg:space-y-8">
            <VerifyEmailBanner />
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

/** Same shape as the loaded dark stat card, so nothing jumps when the numbers arrive. */
function StatSkeleton() {
    return (
        <div
            className="rounded-xl bg-[#1C2C22] dark:bg-[#1A2A20] p-3.5 sm:p-4 shadow-[0_30px_50px_-28px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)] animate-pulse"
            aria-hidden
        >
            <div className="flex items-start justify-between gap-2">
                <div className="mt-1 h-3 w-20 rounded-sm bg-white/10" />
                <div className="h-[26px] w-[26px] rounded bg-white/[0.08]" />
            </div>
            <div className="mt-5 sm:mt-7 h-7 sm:h-9 w-16 rounded-sm bg-white/10" />
            <div className="mt-2.5 h-px w-8 bg-white/15" />
        </div>
    );
}
