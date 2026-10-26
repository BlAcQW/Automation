'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Calendar } from 'lucide-react';
import { Card, EmptyState, FilterChips, PageHeader, SkeletonTableRow, StatusPill } from '@bookingflow/ui';
import { Pager, Table, THead, Td, Th, Tr } from '../_components/parts';
import { formatDateTime } from '../_components/format';

type BookingStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

const STATUSES: BookingStatus[] = ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

const STATUS_LABEL: Record<BookingStatus, string> = {
    CONFIRMED: 'Confirmed',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
    NO_SHOW: 'No-show',
};

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
            <PageHeader title="Bookings" subtitle="Every booking, across every business on Bookly." />

            <FilterChips
                label="Filter by status"
                chips={[{ value: '', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
                selected={[status]}
                onToggle={(value) => {
                    setStatus(value as BookingStatus | '');
                    setPage(1);
                }}
            />

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading bookings…</span>
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)}
                    </div>
                ) : !data?.data?.length ? (
                    <EmptyState
                        icon={<Calendar className="h-6 w-6" aria-hidden />}
                        title="No bookings found"
                        description={status ? 'Nothing with this status yet. Try another filter.' : 'Bookings show up here as customers make them.'}
                    />
                ) : (
                    <>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Reference</Th>
                                    <Th>Business</Th>
                                    <Th>Customer</Th>
                                    <Th>Service</Th>
                                    <Th>Starts</Th>
                                    <Th>Status</Th>
                                </tr>
                            </THead>
                            <tbody>
                                {data.data.map((b: any) => (
                                    <Tr key={b.id}>
                                        <Td><span className="font-mono font-semibold">{b.bookingReference}</span></Td>
                                        <Td label="Business">{b.tenant?.name ?? '-'}</Td>
                                        <Td label="Customer">
                                            <p>{b.customerName}</p>
                                            <p className="text-[14px] text-muted">{b.customerPhone}</p>
                                        </Td>
                                        <Td label="Service">{b.service?.name ?? '-'}</Td>
                                        <Td label="Starts" className="whitespace-nowrap">{formatDateTime(b.startTime)}</Td>
                                        <Td label="Status">
                                            <StatusPill size="sm" status={b.status} label={STATUS_LABEL[b.status as BookingStatus]} />
                                        </Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>

                        {data?.pagination && data.pagination.totalPages > 0 && (
                            <Pager
                                page={page}
                                totalPages={data.pagination.totalPages}
                                onPage={setPage}
                                summary={`Showing ${(page - 1) * 20 + 1}–${Math.min(page * 20, data.pagination.total)} of ${data.pagination.total}`}
                            />
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}
