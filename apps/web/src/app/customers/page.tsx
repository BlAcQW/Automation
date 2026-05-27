'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, Search, Phone, ShoppingBag, Calendar, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';

interface Customer {
    id: string; // phone
    name: string;
    phone: string;
    lastActive: string;
    totalOrders: number;
    totalSpent: number;
    totalBookings: number;
}

export default function CustomersPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const [search, setSearch] = useState('');

    const { data: customersResponse, isLoading } = useQuery({
        queryKey: ['customers', search],
        queryFn: async () => {
            const params: any = {};
            if (search) params.search = search;
            const res = await api.get('/customers', { params });
            return res.data;
        },
    });

    const customers: Customer[] = customersResponse?.data || [];

    const { data: stats = { totalCustomers: 0, activeThisMonth: 0, totalOrders: 0 } } = useQuery({
        queryKey: ['customer-stats'],
        queryFn: async () => {
            const res = await api.get('/customers/stats');
            return res.data;
        },
    });

    if (!productEnabled) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <PageHeader
                title="Customers"
                subtitle="Manage customer relationships and history"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    name="Total Customers"
                    value={stats.totalCustomers}
                    icon={<Users className="w-6 h-6 text-blue-500" />}
                    color="bg-blue-500/10"
                    index={0}
                />
                <StatCard
                    name="Active This Month"
                    value={stats.activeThisMonth}
                    icon={<MessageSquare className="w-6 h-6 text-emerald-500" />}
                    color="bg-emerald-500/10"
                    index={1}
                />
                <StatCard
                    name="Total Orders"
                    value={stats.totalOrders}
                    icon={<ShoppingBag className="w-6 h-6 text-purple-500" />}
                    color="bg-purple-500/10"
                    index={2}
                />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center bg-white dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-xl">
                <div className="relative flex-1 w-full sm:max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                    <DashboardInput
                        placeholder="Search customers by name or phone..."
                        className="pl-10 bg-transparent border-slate-200 dark:border-slate-700/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/50 dark:bg-slate-700/20 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Customer</th>
                                <th className="px-6 py-4">Contact</th>
                                <th className="px-6 py-4">Orders</th>
                                <th className="px-6 py-4">Spent</th>
                                <th className="px-6 py-4">Bookings</th>
                                <th className="px-6 py-4">Last Active</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <BooklyDots size="sm" />
                                            <p>Loading customers...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : customers.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Users className="w-8 h-8 text-slate-300" />
                                            <p>No customers found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                customers.map((customer) => (
                                    <tr key={customer.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            {customer.name}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 font-mono">
                                            {customer.phone}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                            {customer.totalOrders}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            ${customer.totalSpent.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                            {customer.totalBookings}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">
                                            {format(new Date(customer.lastActive), 'MMM d, yyyy')}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile: stacked customer cards */}
                <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
                    {isLoading ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <BooklyDots size="sm" />
                                <p>Loading customers...</p>
                            </div>
                        </div>
                    ) : customers.length === 0 ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <Users className="w-8 h-8 text-slate-300" />
                                <p>No customers found</p>
                            </div>
                        </div>
                    ) : (
                        customers.map((customer) => (
                            <div key={customer.id} className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-slate-900 dark:text-white truncate">{customer.name}</p>
                                        <p className="flex items-center gap-1 text-xs text-slate-500 font-mono mt-0.5">
                                            <Phone className="w-3 h-3" />
                                            {customer.phone}
                                        </p>
                                    </div>
                                    <span className="font-medium text-sm text-slate-900 dark:text-white shrink-0">
                                        ${customer.totalSpent.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                                    <span className="flex items-center gap-1">
                                        <ShoppingBag className="w-3.5 h-3.5" />
                                        {customer.totalOrders} orders
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {customer.totalBookings} bookings
                                    </span>
                                    <span className="ml-auto text-slate-400">
                                        {format(new Date(customer.lastActive), 'MMM d')}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
