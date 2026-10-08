'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Users, Calendar, MessageSquare, TrendingUp, CalendarCheck } from 'lucide-react';
import { Card } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';

interface StatBlockProps {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
}

function StatBlock({ label, value, sub, icon: Icon }: StatBlockProps) {
    return (
        <Card className="rounded-xl border-white/5 bg-forest-card p-6 text-forest-cream shadow-[0_30px_50px_-28px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.06)]">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-slate-400">{label}</p>
                    <p className="mt-3 text-[34px] font-light leading-none tracking-[-0.04em] tabular-nums text-forest-cream">{value}</p>
                    {sub && <p className="text-sm text-slate-500 mt-1">{sub}</p>}
                </div>
                <div className="w-10 h-10 rounded-[5px] bg-forest-brand/40 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-emerald-400" />
                </div>
            </div>
        </Card>
    );
}

export default function AdminStatsPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'stats'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/stats');
            return res.data;
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <BooklyDots size="md" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-[28px] sm:text-[34px] font-normal leading-none tracking-[-0.045em] text-white">Platform Statistics</h1>
                </div>
                <Card className="rounded-xl border-white/5 bg-forest-card p-6 text-forest-cream shadow-[0_30px_50px_-28px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.06)]">
                    <p className="text-red-400">Failed to load statistics.</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-[28px] sm:text-[34px] font-normal leading-none tracking-[-0.045em] text-white">Platform Statistics</h1>
                <p className="text-slate-400">A live snapshot of the platform.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatBlock
                    label="Total Tenants"
                    value={data.tenants.total}
                    sub={`${data.tenants.active} active`}
                    icon={Building2}
                />
                <StatBlock
                    label="New Tenants This Month"
                    value={data.tenants.newThisMonth}
                    icon={TrendingUp}
                />
                <StatBlock label="Total Users" value={data.users.total} icon={Users} />
                <StatBlock
                    label="Total Bookings"
                    value={data.bookings.total}
                    sub={`${data.bookings.today} today`}
                    icon={Calendar}
                />
                <StatBlock label="Bookings Today" value={data.bookings.today} icon={CalendarCheck} />
                <StatBlock
                    label="Conversations"
                    value={data.conversations.total}
                    icon={MessageSquare}
                />
            </div>
        </div>
    );
}
