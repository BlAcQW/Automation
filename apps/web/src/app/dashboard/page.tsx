'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
    Calendar,
    Clock,
    Users,
    TrendingUp,
    MessageSquare,
    AlertCircle
} from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
    const { tenant } = useAuth();

    const { data: upcomingBookings } = useQuery({
        queryKey: ['bookings', 'upcoming'],
        queryFn: async () => {
            const res = await api.get('/bookings/upcoming');
            return res.data.data;
        },
    });

    const { data: humanActiveConversations } = useQuery({
        queryKey: ['conversations', 'human-active'],
        queryFn: async () => {
            const res = await api.get('/conversations/human-active');
            return res.data.data;
        },
    });

    const { data: whatsappStatus } = useQuery({
        queryKey: ['whatsapp', 'status'],
        queryFn: async () => {
            const res = await api.get('/whatsapp/status');
            return res.data;
        },
    });

    const stats = [
        {
            name: "Today's Bookings",
            value: upcomingBookings?.length || 0,
            icon: Calendar,
            color: 'bg-blue-500',
        },
        {
            name: 'Human Takeovers',
            value: humanActiveConversations?.length || 0,
            icon: Users,
            color: 'bg-orange-500',
        },
        {
            name: 'WhatsApp Status',
            value: whatsappStatus?.connected ? 'Connected' : 'Not Connected',
            icon: MessageSquare,
            color: whatsappStatus?.connected ? 'bg-green-500' : 'bg-red-500',
        },
    ];

    return (
        <div className="space-y-6">
            {/* Welcome */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Welcome back!
                </h1>
                <p className="text-slate-500 dark:text-slate-400">
                    Here&apos;s what&apos;s happening with {tenant?.name} today.
                </p>
            </div>

            {/* WhatsApp Warning */}
            {!whatsappStatus?.connected && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                    <div className="flex-1">
                        <h3 className="font-medium text-yellow-800 dark:text-yellow-200">
                            WhatsApp Not Connected
                        </h3>
                        <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                            Connect your WhatsApp Business account to start receiving bookings.
                        </p>
                        <Link
                            href="/dashboard/settings"
                            className="inline-block mt-2 text-sm font-medium text-yellow-800 dark:text-yellow-200 hover:underline"
                        >
                            Connect WhatsApp →
                        </Link>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid md:grid-cols-3 gap-6">
                {stats.map((stat, index) => (
                    <div
                        key={index}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400">{stat.name}</p>
                                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                                    {stat.value}
                                </p>
                            </div>
                            <div className={`w-12 h-12 ${stat.color} rounded-xl flex items-center justify-center`}>
                                <stat.icon className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Content Grid */}
            <div className="grid lg:grid-cols-2 gap-6">
                {/* Upcoming Bookings */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold text-slate-900 dark:text-white">
                                Upcoming Bookings
                            </h2>
                            <Link
                                href="/dashboard/bookings"
                                className="text-sm text-primary-500 hover:text-primary-600"
                            >
                                View All
                            </Link>
                        </div>
                    </div>
                    <div className="p-6">
                        {upcomingBookings && upcomingBookings.length > 0 ? (
                            <div className="space-y-4">
                                {upcomingBookings.slice(0, 5).map((booking: any) => (
                                    <div
                                        key={booking.id}
                                        className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-700 last:border-0"
                                    >
                                        <div>
                                            <p className="font-medium text-slate-900 dark:text-white">
                                                {booking.customerName}
                                            </p>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                {booking.service?.name}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-medium text-slate-900 dark:text-white">
                                                {new Date(booking.startTime).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <Calendar className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-500 dark:text-slate-400">No upcoming bookings today</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Human Takeovers */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold text-slate-900 dark:text-white">
                                Needs Attention
                            </h2>
                            <Link
                                href="/dashboard/conversations"
                                className="text-sm text-primary-500 hover:text-primary-600"
                            >
                                View All
                            </Link>
                        </div>
                    </div>
                    <div className="p-6">
                        {humanActiveConversations && humanActiveConversations.length > 0 ? (
                            <div className="space-y-4">
                                {humanActiveConversations.slice(0, 5).map((conv: any) => (
                                    <div
                                        key={conv.id}
                                        className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-700 last:border-0"
                                    >
                                        <div>
                                            <p className="font-medium text-slate-900 dark:text-white">
                                                {conv.customerName || conv.customerPhone}
                                            </p>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                                {conv.lastMessage}
                                            </p>
                                        </div>
                                        <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-xs font-medium rounded">
                                            Human Active
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <MessageSquare className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-500 dark:text-slate-400">
                                    No conversations need attention
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
