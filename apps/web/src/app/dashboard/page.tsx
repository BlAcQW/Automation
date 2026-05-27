'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';
import {
    Calendar,
    MessageCircle,
    Users,
    TrendingUp,
    Clock,
    AlertTriangle,
    Smartphone,
    Loader2,
    ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';

interface DashboardStats {
    totalBookings: number;
    todayBookings: number;
    activeConversations: number;
    totalCustomers: number;
}

interface UpcomingBooking {
    id: string;
    customerName: string;
    customerPhone: string;
    serviceName: string;
    startTime: string;
    status: string;
}

export default function DashboardPage() {
    const { tenant } = useAuth();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboard();
    }, []);

    const fetchDashboard = async () => {
        try {
            const [statsRes, bookingsRes] = await Promise.all([
                api.get('/dashboard/stats'),
                api.get('/bookings?status=CONFIRMED&limit=5'),
            ]);
            setStats(statsRes.data.data);
            setUpcoming(bookingsRes.data.data);
        } catch (err) {
            console.error('Failed to fetch dashboard:', err);
        } finally {
            setLoading(false);
        }
    };

    const statusVariant: Record<string, 'default' | 'yellow' | 'red' | 'blue' | 'slate'> = {
        CONFIRMED: 'default',
        PENDING: 'yellow',
        CANCELLED: 'red',
        COMPLETED: 'blue',
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Welcome back, {tenant?.name}
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-1">
                    Here&apos;s what&apos;s happening with your business today
                </p>
            </div>

            {/* WhatsApp Warning — only shown when not yet connected */}
            {!tenant?.whatsappConnected && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-2xl p-4 flex items-center gap-3"
                >
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                        <Smartphone className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1">
                        <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Connect WhatsApp</p>
                        <p className="text-amber-700 dark:text-amber-300 text-sm">
                            Connect your WhatsApp number to start receiving bookings.
                        </p>
                    </div>
                    <Link href="/whatsapp" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                        Connect
                    </Link>
                </motion.div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    name="Total Bookings"
                    value={stats?.totalBookings || 0}
                    icon={<Calendar className="w-6 h-6 text-white" />}
                    color="bg-blue-500"
                    index={0}
                />
                <StatCard
                    name="Today's Bookings"
                    value={stats?.todayBookings || 0}
                    icon={<Clock className="w-6 h-6 text-white" />}
                    color="bg-emerald-500"
                    index={1}
                />
                <StatCard
                    name="Active Conversations"
                    value={stats?.activeConversations || 0}
                    icon={<MessageCircle className="w-6 h-6 text-white" />}
                    color="bg-purple-500"
                    index={2}
                />
                <StatCard
                    name="Total Customers"
                    value={stats?.totalCustomers || 0}
                    icon={<Users className="w-6 h-6 text-white" />}
                    color="bg-orange-500"
                    index={3}
                />
            </div>

            {/* Upcoming Bookings */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between w-full">
                        <CardTitle>
                            <Calendar className="w-5 h-5 text-emerald-500" />
                            Upcoming Bookings
                        </CardTitle>
                        <Link href="/bookings" className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 font-medium flex items-center gap-1">
                            View all <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {upcoming.length === 0 ? (
                        <div className="py-12 text-center">
                            <Calendar className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                            <p className="text-slate-500 dark:text-slate-400">No upcoming bookings</p>
                            <Link href="/bookings" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'mt-3' })}>
                                Create a booking
                            </Link>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80">
                            {upcoming.map((booking, index) => (
                                <motion.div
                                    key={booking.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                                            <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <div>
                                            <p className="font-medium text-slate-900 dark:text-white text-sm">{booking.customerName}</p>
                                            <p className="text-slate-500 dark:text-slate-400 text-xs">
                                                {booking.serviceName} · {new Date(booking.startTime).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                    <Badge variant={statusVariant[booking.status] || 'slate'}>
                                        {booking.status}
                                    </Badge>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
