'use client';

import { useQuery } from '@tanstack/react-query';
import {
    Calendar,
    MessageCircle,
    Users,
    Clock,
    DollarSign,
    ShoppingBag,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { StatCard } from '@/components/ui/stat-card';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { BooklyDots } from '@/components/primitives/bookly-dots';

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

    if (statsLoading) {
        return (
            <div className="flex justify-center py-12">
                <BooklyDots size="md" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {isProduct ? (
                    <>
                        <StatCard
                            name="Total Sales"
                            value={`$${Number(orderStats?.revenue ?? 0).toFixed(2)}`}
                            icon={<DollarSign className="w-5 h-5 text-white" />}
                            color="bg-emerald-500"
                            index={0}
                        />
                        <StatCard
                            name="Orders"
                            value={orderStats?.total ?? 0}
                            icon={<ShoppingBag className="w-5 h-5 text-white" />}
                            color="bg-blue-500"
                            index={1}
                        />
                        <StatCard
                            name="Active Chats"
                            value={stats?.activeConversations ?? 0}
                            icon={<MessageCircle className="w-5 h-5 text-white" />}
                            color="bg-purple-500"
                            index={2}
                            change={{ value: 0, direction: 'neutral', label: 'Active' }}
                        />
                        <StatCard
                            name="Customers"
                            value={stats?.totalCustomers ?? 0}
                            icon={<Users className="w-5 h-5 text-white" />}
                            color="bg-orange-500"
                            index={3}
                        />
                    </>
                ) : (
                    <>
                        <StatCard
                            name="Total Bookings"
                            value={stats?.totalBookings ?? 0}
                            icon={<Calendar className="w-5 h-5 text-white" />}
                            color="bg-blue-500"
                            index={0}
                        />
                        <StatCard
                            name="Today's Bookings"
                            value={stats?.todayBookings ?? 0}
                            icon={<Clock className="w-5 h-5 text-white" />}
                            color="bg-emerald-500"
                            index={1}
                        />
                        <StatCard
                            name="Active Chats"
                            value={stats?.activeConversations ?? 0}
                            icon={<MessageCircle className="w-5 h-5 text-white" />}
                            color="bg-purple-500"
                            index={2}
                            change={{ value: 0, direction: 'neutral', label: 'Active' }}
                        />
                        <StatCard
                            name="Customers"
                            value={stats?.totalCustomers ?? 0}
                            icon={<Users className="w-5 h-5 text-white" />}
                            color="bg-orange-500"
                            index={3}
                        />
                    </>
                )}
            </div>

            <RecentActivity />
        </div>
    );
}
