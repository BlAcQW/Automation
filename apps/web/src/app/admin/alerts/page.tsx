'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import { Card, Badge, Button } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';

interface PlatformAlert {
    id: string;
    tenantId: string | null;
    tenantName: string | null;
    kind: string;
    severity: 'info' | 'warning' | 'critical' | string;
    message: string;
    count: number;
    lastSeenAt: string;
}

const SEVERITY_VARIANT: Record<string, 'red' | 'yellow' | 'blue'> = {
    critical: 'red',
    warning: 'yellow',
    info: 'blue',
};

export default function AdminAlertsPage() {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'alerts', 'open', page],
        queryFn: async () => {
            const params = new URLSearchParams({ status: 'open', page: String(page), limit: '20' });
            return (await adminApi.get(`/admin/alerts?${params}`)).data as {
                data: PlatformAlert[];
                pagination: { page: number; total: number; totalPages: number };
            };
        },
    });

    const resolve = useMutation({
        mutationFn: async (id: string) => (await adminApi.post(`/admin/alerts/${id}/resolve`)).data,
        onSuccess: () => {
            toast.success('Alert resolved');
            queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Could not resolve the alert'),
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Alerts</h1>
                <p className="text-slate-400">Open platform alerts, newest activity first. Repeats of the same problem raise the count instead of adding rows.</p>
            </div>

            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48"><BooklyDots size="md" /></div>
                ) : !data?.data.length ? (
                    <div className="px-6 py-12 text-center">
                        <Bell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                        <p className="text-slate-400">No open alerts</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                        <th className="px-6 py-4 font-medium">Severity</th>
                                        <th className="px-6 py-4 font-medium">Tenant</th>
                                        <th className="px-6 py-4 font-medium">Message</th>
                                        <th className="px-6 py-4 font-medium">Count</th>
                                        <th className="px-6 py-4 font-medium">Last seen</th>
                                        <th className="px-6 py-4 font-medium w-1"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.data.map((a) => (
                                        <tr key={a.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4">
                                                <Badge variant={SEVERITY_VARIANT[a.severity] ?? 'slate'}>{a.severity.toUpperCase()}</Badge>
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                {a.tenantId ? (
                                                    <Link href={`/admin/tenants/${a.tenantId}`} className="text-white hover:text-emerald-400 transition-colors">
                                                        {a.tenantName ?? a.tenantId}
                                                    </Link>
                                                ) : (
                                                    <span className="text-slate-500">Platform</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-300 max-w-xl">
                                                <p>{a.message}</p>
                                                <p className="text-xs text-slate-500 font-mono">{a.kind}</p>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-300 tabular-nums">{a.count.toLocaleString()}</td>
                                            <td className="px-6 py-4 text-sm text-slate-400">{new Date(a.lastSeenAt).toLocaleString('en-GB')}</td>
                                            <td className="px-6 py-4">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => resolve.mutate(a.id)}
                                                    disabled={resolve.isPending && resolve.variables === a.id}
                                                >
                                                    Resolve
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {data.pagination.totalPages > 1 && (
                            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                                <p className="text-sm text-slate-400">{data.pagination.total} open alerts</p>
                                <div className="flex items-center space-x-2">
                                    <Button variant="outline" size="icon" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="h-8 w-8">
                                        <ChevronLeft className="w-4 h-4" />
                                    </Button>
                                    <span className="text-white px-3 text-sm">Page {page} of {data.pagination.totalPages}</span>
                                    <Button variant="outline" size="icon" onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))} disabled={page >= data.pagination.totalPages} className="h-8 w-8">
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
