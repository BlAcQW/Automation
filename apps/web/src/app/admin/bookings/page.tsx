'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type BookingStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

const STATUSES: BookingStatus[] = ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

function statusVariant(status: BookingStatus) {
    switch (status) {
        case 'CONFIRMED':
            return 'default';
        case 'COMPLETED':
            return 'slate';
        case 'CANCELLED':
        case 'NO_SHOW':
            return 'red';
    }
}

export default function AdminBookingsPage() {
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<BookingStatus | ''>('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'bookings', page, status],
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (status) params.set('status', status);
            const res = await adminApi.get(`/admin/bookings?${params}`);
            return res.data;
        },
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Bookings</h1>
                <p className="text-slate-400">All bookings across every tenant on the platform.</p>
            </div>

            <div className="flex gap-2">
                <Button
                    variant={status === '' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                        setStatus('');
                        setPage(1);
                    }}
                >
                    All
                </Button>
                {STATUSES.map((s) => (
                    <Button
                        key={s}
                        variant={status === s ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                            setStatus(s);
                            setPage(1);
                        }}
                    >
                        {s}
                    </Button>
                ))}
            </div>

            <Card className="glass-card border-white/5">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-8 h-8 border-4 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-left text-sm text-slate-400 border-b border-white/5">
                                        <th className="px-6 py-4 font-medium">Reference</th>
                                        <th className="px-6 py-4 font-medium">Tenant</th>
                                        <th className="px-6 py-4 font-medium">Customer</th>
                                        <th className="px-6 py-4 font-medium">Service</th>
                                        <th className="px-6 py-4 font-medium">Start</th>
                                        <th className="px-6 py-4 font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {!data?.data?.length ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center">
                                                <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                                <p className="text-slate-400">No bookings found</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        data.data.map((b: any) => (
                                            <tr
                                                key={b.id}
                                                className="border-b border-white/5 hover:bg-white/5 transition-colors"
                                            >
                                                <td className="px-6 py-4 text-white font-medium">
                                                    {b.bookingReference}
                                                </td>
                                                <td className="px-6 py-4 text-slate-300">{b.tenant?.name ?? '—'}</td>
                                                <td className="px-6 py-4">
                                                    <p className="text-white">{b.customerName}</p>
                                                    <p className="text-sm text-slate-500">{b.customerPhone}</p>
                                                </td>
                                                <td className="px-6 py-4 text-slate-300">{b.service?.name ?? '—'}</td>
                                                <td className="px-6 py-4 text-slate-300">
                                                    {new Date(b.startTime).toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <Badge variant={statusVariant(b.status as BookingStatus)}>
                                                        {b.status}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {data?.pagination && data.pagination.totalPages > 0 && (
                            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                                <p className="text-sm text-slate-400">
                                    Showing {(page - 1) * 20 + 1} to{' '}
                                    {Math.min(page * 20, data.pagination.total)} of {data.pagination.total}
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
