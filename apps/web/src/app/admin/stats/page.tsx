'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Users, Calendar, Inbox, TrendingUp, CalendarCheck } from 'lucide-react';
import { ErrorState, PageHeader, SkeletonCard, StatCard } from '@bookingflow/ui';

export default function AdminStatsPage() {
    const { data, isLoading, error, refetch, isRefetching } = useQuery({
        queryKey: ['admin', 'stats'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/stats');
            return res.data;
        },
    });

    const header = <PageHeader title="Platform statistics" subtitle="A live snapshot of the platform." />;

    if (isLoading) {
        return (
            <div className="space-y-6" aria-busy="true">
                {header}
                <span className="sr-only">Loading…</span>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="space-y-6">
                {header}
                <ErrorState title="We couldn't load the statistics" onRetry={() => refetch()} isRetrying={isRefetching} />
            </div>
        );
    }

    const blocks = [
        { name: 'Businesses', value: data.tenants.total, icon: Building2, sub: `${data.tenants.active} active` },
        { name: 'New businesses this month', value: data.tenants.newThisMonth, icon: TrendingUp },
        { name: 'Users', value: data.users.total, icon: Users },
        { name: 'Bookings', value: data.bookings.total, icon: Calendar, sub: `${data.bookings.today} today` },
        { name: 'Bookings today', value: data.bookings.today, icon: CalendarCheck },
        { name: 'Conversations', value: data.conversations.total, icon: Inbox },
    ];

    return (
        <div className="space-y-6">
            {header}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                {blocks.map((b, i) => (
                    <div key={b.name} className="space-y-1">
                        <StatCard name={b.name} value={b.value} icon={<b.icon aria-hidden />} index={i} />
                        {b.sub && <p className="px-1 text-[14px] text-muted">{b.sub}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
}
