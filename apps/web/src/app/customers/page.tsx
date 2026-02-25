'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, Search, Phone, ShoppingBag, Calendar, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';

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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                        Customers
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Manage customer relationships and history
                    </p>
                </div>
            </div>

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
                <div className="overflow-x-auto">
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
                                            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
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
            </div>
        </div>
    );
}
