'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Users, Calendar, MessageSquare, TrendingUp, CalendarCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { BooklyDots } from '@/components/primitives/bookly-dots';

interface StatBlockProps {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
}

function StatBlock({ label, value, sub, icon: Icon }: StatBlockProps) {
    return (
        <Card className="glass-card border-white/5 p-6">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-slate-400">{label}</p>
                    <p className="text-3xl font-bold text-white mt-2">{value}</p>
                    {sub && <p className="text-sm text-slate-500 mt-1">{sub}</p>}
                </div>
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
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
                    <h1 className="text-2xl font-bold text-white">Platform Statistics</h1>
                </div>
                <Card className="glass-card border-white/5 p-6">
                    <p className="text-red-400">Failed to load statistics.</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Platform Statistics</h1>
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
