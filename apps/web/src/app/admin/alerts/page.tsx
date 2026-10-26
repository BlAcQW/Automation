'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import { Button, Card, EmptyState, PageHeader, SkeletonTableRow, StatusPill } from '@bookingflow/ui';
import { Pager, Table, THead, Td, Th, Tr } from '../_components/parts';
import { SEVERITY_TONE } from '../_components/attention-panel';
import { formatDateTime } from '../_components/format';

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
        onError: (err: any) => toast.error(err?.response?.data?.message ?? "Couldn't resolve the alert. Let's try again."),
    });

    return (
        <div className="space-y-6">
            <PageHeader
                title="Alerts"
                subtitle="Open platform alerts, newest first. When the same problem repeats, its count goes up instead of adding a row."
            />

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading alerts…</span>
                        {Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} columns={5} />)}
                    </div>
                ) : !data?.data.length ? (
                    <EmptyState
                        icon={<Bell className="h-6 w-6" aria-hidden />}
                        title="No open alerts"
                        description="All calm. New problems will show up here."
                    />
                ) : (
                    <>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Severity</Th>
                                    <Th>Business</Th>
                                    <Th>Message</Th>
                                    <Th>Count</Th>
                                    <Th>Last seen</Th>
                                    <Th className="w-1" />
                                </tr>
                            </THead>
                            <tbody>
                                {data.data.map((a) => (
                                    <Tr key={a.id}>
                                        <Td><StatusPill size="sm" status={a.severity} tone={SEVERITY_TONE[a.severity] ?? 'neutral'} /></Td>
                                        <Td label="Business">
                                            {a.tenantId ? (
                                                <Link href={`/admin/tenants/${a.tenantId}`} className="font-medium text-text hover:text-primary">
                                                    {a.tenantName ?? a.tenantId}
                                                </Link>
                                            ) : (
                                                <span className="text-muted">Platform</span>
                                            )}
                                        </Td>
                                        <Td label="Message" className="md:max-w-xl">
                                            <p>{a.message}</p>
                                            <p className="font-mono text-[13px] text-muted">{a.kind}</p>
                                        </Td>
                                        <Td label="Count" className="tabular-nums">{a.count.toLocaleString()}</Td>
                                        <Td label="Last seen" className="whitespace-nowrap text-muted">{formatDateTime(a.lastSeenAt)}</Td>
                                        <Td>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="w-full md:w-auto"
                                                onClick={() => resolve.mutate(a.id)}
                                                isLoading={resolve.isPending && resolve.variables === a.id}
                                            >
                                                Resolve
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                        {data.pagination.totalPages > 1 && (
                            <Pager
                                page={page}
                                totalPages={data.pagination.totalPages}
                                onPage={setPage}
                                summary={`${data.pagination.total} open alerts`}
                            />
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}
