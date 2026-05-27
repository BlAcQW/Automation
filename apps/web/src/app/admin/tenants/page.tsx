'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Search, Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BooklyDots } from '@/components/primitives/bookly-dots';

export default function AdminTenantsPage() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'tenants', page, search],
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (search) params.set('search', search);
            const res = await adminApi.get(`/admin/tenants?${params}`);
            return res.data;
        },
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Tenants</h1>
                    <p className="text-slate-400">Manage all business tenants on the platform.</p>
                </div>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <Input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search tenants..."
                        className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                    />
                </div>
                <Button type="submit">
                    Search
                </Button>
            </form>

            {/* Table */}
            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <BooklyDots size="md" />
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                        <th className="px-6 py-4 font-medium">Tenant</th>
                                        <th className="px-6 py-4 font-medium">Plan</th>
                                        <th className="px-6 py-4 font-medium">Msgs (mo)</th>
                                        <th className="px-6 py-4 font-medium">Timezone</th>
                                        <th className="px-6 py-4 font-medium">Users</th>
                                        <th className="px-6 py-4 font-medium">Services</th>
                                        <th className="px-6 py-4 font-medium">Bookings</th>
                                        <th className="px-6 py-4 font-medium">WhatsApp</th>
                                        <th className="px-6 py-4 font-medium">Status</th>
                                        <th className="px-6 py-4 font-medium">Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.data?.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="px-6 py-12 text-center">
                                                <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                                <p className="text-slate-400">No tenants found</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        data?.data?.map((tenant: any) => (
                                            <tr key={tenant.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <Link
                                                        href={`/admin/tenants/${tenant.id}`}
                                                        className="font-medium text-white hover:text-emerald-400 transition-colors"
                                                    >
                                                        {tenant.name}
                                                    </Link>
                                                    {tenant.whatsappDisplayNumber && (
                                                        <p className="text-sm text-slate-500">{tenant.whatsappDisplayNumber}</p>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <Badge variant={tenant.planId === 'pro' ? 'default' : tenant.planId === 'starter' ? 'blue' : 'slate'}>
                                                        {(tenant.planId ?? 'free').toUpperCase()}
                                                    </Badge>
                                                </td>
                                                <td className="px-6 py-4 text-slate-300 font-mono text-sm">
                                                    {(tenant.messagesThisMonth ?? 0).toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 text-slate-300">{tenant.timezone}</td>
                                                <td className="px-6 py-4 text-slate-300">{tenant.usersCount}</td>
                                                <td className="px-6 py-4 text-slate-300">{tenant.servicesCount}</td>
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
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {data?.pagination && (
                            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                                <p className="text-sm text-slate-400">
                                    Showing {((page - 1) * 20) + 1} to {Math.min(page * 20, data.pagination.total)} of {data.pagination.total} tenants
                                </p>
                                <div className="flex items-center space-x-2">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setPage(Math.max(1, page - 1))}
                                        disabled={page === 1}
                                        className="h-8 w-8"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                    </Button>
                                    <span className="text-white px-3 text-sm">
                                        Page {page} of {data.pagination.totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))}
                                        disabled={page === data.pagination.totalPages}
                                        className="h-8 w-8"
                                    >
                                        <ChevronRight className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}
