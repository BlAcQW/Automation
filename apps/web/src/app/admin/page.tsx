'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Users, Calendar, MessageSquare, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function AdminDashboardPage() {
    const { data: stats, isLoading } = useQuery({
        queryKey: ['admin', 'stats'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/stats');
            return res.data;
        },
    });

    const { data: recentTenants } = useQuery({
        queryKey: ['admin', 'tenants', 'recent'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/tenants?limit=5');
            return res.data.data;
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
            </div>
        );
    }

    const statCards = [
        {
            name: 'Total Tenants',
            value: stats?.tenants?.total || 0,
            subValue: `${stats?.tenants?.active || 0} active`,
            icon: Building2,
            color: 'bg-blue-500',
        },
        {
            name: 'Total Users',
            value: stats?.users?.total || 0,
            icon: Users,
            color: 'bg-purple-500',
        },
        {
            name: 'Total Bookings',
            value: stats?.bookings?.total || 0,
            subValue: `${stats?.bookings?.today || 0} today`,
            icon: Calendar,
            color: 'bg-green-500',
        },
        {
            name: 'Conversations',
            value: stats?.conversations?.total || 0,
            icon: MessageSquare,
            color: 'bg-orange-500',
        },
        {
            name: 'New This Month',
            value: stats?.tenants?.newThisMonth || 0,
            subValue: 'tenants',
            icon: TrendingUp,
            color: 'bg-cyan-500',
        },
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
                <p className="text-slate-400">Monitor and manage all tenants from here.</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {statCards.map((stat, index) => (
                    <StatCard
                        key={index}
                        name={stat.name}
                        value={stat.value}
                        icon={<stat.icon className="w-6 h-6 text-white" />}
                        color={stat.color}
                        index={index}
                    />
                ))}
            </div>

            {/* Recent Tenants */}
            <Card className="glass-card border-white/5">
                <CardHeader className="flex flex-row items-center justify-between border-b border-white/5 pb-4">
                    <CardTitle className="text-lg font-semibold text-white">Recent Tenants</CardTitle>
                    <Link href="/admin/tenants">
                        <Button variant="ghost" className="text-sm h-8">
                            View All →
                        </Button>
                    </Link>
                </CardHeader>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                <th className="px-6 py-4 font-medium">Name</th>
                                <th className="px-6 py-4 font-medium">Users</th>
                                <th className="px-6 py-4 font-medium">Bookings</th>
                                <th className="px-6 py-4 font-medium">WhatsApp</th>
                                <th className="px-6 py-4 font-medium">Status</th>
                                <th className="px-6 py-4 font-medium">Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentTenants?.map((tenant: any) => (
                                <tr key={tenant.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-4">
                                        <Link
                                            href={`/admin/tenants/${tenant.id}`}
                                            className="font-medium text-white hover:text-emerald-400 transition-colors"
                                        >
                                            {tenant.name}
                                        </Link>
                                    </td>
                                    <td className="px-6 py-4 text-slate-300">{tenant.usersCount}</td>
                                    <td className="px-6 py-4 text-slate-300">{tenant.bookingsCount}</td>
                                    <td className="px-6 py-4">
                                        <Badge variant={tenant.whatsappConnected ? 'default' : 'slate'}>
                                            {tenant.whatsappConnected ? 'Connected' : 'Not Connected'}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant={tenant.isActive ? 'default' : 'red'}>
                                            {tenant.isActive ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4 text-slate-400 text-sm">
                                        {new Date(tenant.createdAt).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
