'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Search, Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

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
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search tenants..."
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-slate-600 transition-colors"
                    />
                </div>
                <button
                    type="submit"
                    className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                >
                    Search
                </button>
            </form>

            {/* Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-sm text-slate-400 border-b border-slate-700">
                                        <th className="px-6 py-4 font-medium">Tenant</th>
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
                                            <td colSpan={8} className="px-6 py-12 text-center">
                                                <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                                <p className="text-slate-400">No tenants found</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        data?.data?.map((tenant: any) => (
                                            <tr key={tenant.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                                <td className="px-6 py-4">
                                                    <Link
                                                        href={`/admin/tenants/${tenant.id}`}
                                                        className="font-medium text-white hover:text-primary-400"
                                                    >
                                                        {tenant.name}
                                                    </Link>
                                                    {tenant.whatsappDisplayNumber && (
                                                        <p className="text-sm text-slate-500">{tenant.whatsappDisplayNumber}</p>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-slate-300">{tenant.timezone}</td>
                                                <td className="px-6 py-4 text-slate-300">{tenant.usersCount}</td>
                                                <td className="px-6 py-4 text-slate-300">{tenant.servicesCount}</td>
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
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {data?.pagination && (
                            <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-between">
                                <p className="text-sm text-slate-400">
                                    Showing {((page - 1) * 20) + 1} to {Math.min(page * 20, data.pagination.total)} of {data.pagination.total} tenants
                                </p>
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={() => setPage(Math.max(1, page - 1))}
                                        disabled={page === 1}
                                        className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronLeft className="w-5 h-5 text-white" />
                                    </button>
                                    <span className="text-white px-3">
                                        Page {page} of {data.pagination.totalPages}
                                    </span>
                                    <button
                                        onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))}
                                        disabled={page === data.pagination.totalPages}
                                        className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronRight className="w-5 h-5 text-white" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
