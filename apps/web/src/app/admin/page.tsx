'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Users, Calendar, MessageSquare, TrendingUp } from 'lucide-react';
import Link from 'next/link';

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
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {statCards.map((stat, index) => (
                    <div
                        key={index}
                        className="bg-slate-800 rounded-xl p-5 border border-slate-700"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className={`w-10 h-10 ${stat.color} rounded-lg flex items-center justify-center`}>
                                <stat.icon className="w-5 h-5 text-white" />
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-white">{stat.value.toLocaleString()}</p>
                        <p className="text-sm text-slate-400">{stat.name}</p>
                        {stat.subValue && (
                            <p className="text-xs text-slate-500 mt-1">{stat.subValue}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* Recent Tenants */}
            <div className="bg-slate-800 rounded-xl border border-slate-700">
                <div className="p-6 border-b border-slate-700 flex items-center justify-between">
                    <h2 className="font-semibold text-white">Recent Tenants</h2>
                    <Link
                        href="/admin/tenants"
                        className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                        View All →
                    </Link>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-left text-sm text-slate-400 border-b border-slate-700">
                                <th className="px-6 py-3 font-medium">Name</th>
                                <th className="px-6 py-3 font-medium">Users</th>
                                <th className="px-6 py-3 font-medium">Bookings</th>
                                <th className="px-6 py-3 font-medium">WhatsApp</th>
                                <th className="px-6 py-3 font-medium">Status</th>
                                <th className="px-6 py-3 font-medium">Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentTenants?.map((tenant: any) => (
                                <tr key={tenant.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                    <td className="px-6 py-4">
                                        <Link
                                            href={`/admin/tenants/${tenant.id}`}
                                            className="font-medium text-white hover:text-primary-400"
                                        >
                                            {tenant.name}
                                        </Link>
                                    </td>
                                    <td className="px-6 py-4 text-slate-300">{tenant.usersCount}</td>
                                    <td className="px-6 py-4 text-slate-300">{tenant.bookingsCount}</td>
                                    <td className="px-6 py-4">
                                        {tenant.whatsappConnected ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                                Connected
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-600/50 text-slate-400">
                                                Not Connected
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        {tenant.isActive ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                                Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">
                                                Inactive
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-slate-400 text-sm">
                                        {new Date(tenant.createdAt).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
