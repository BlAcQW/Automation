'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Users, Calendar, Inbox, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { StatCard, Card, PageHeader, SkeletonCard, StatusPill, buttonVariants } from '@bookingflow/ui';
import { useAdmin } from './admin-context';
import { AttentionPanel } from './_components/attention-panel';
import { Empty, Table, THead, Td, Th, Tr } from './_components/parts';
import { formatDate } from './_components/format';

export default function AdminDashboardPage() {
    const { can } = useAdmin();
    const { data: stats, isLoading } = useQuery({
        queryKey: ['admin', 'stats'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/stats');
            return res.data;
        },
    });

    const { data: recentTenants } = useQuery({
        queryKey: ['admin', 'tenants', 'recent'],
        queryFn: async () => {
            const res = await adminApi.get('/admin/tenants?limit=5');
            return res.data.data;
        },
    });

    if (isLoading) {
        return (
            <div className="space-y-6" aria-busy="true">
                <span className="sr-only">Loading…</span>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                    {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            </div>
        );
    }

    const statCards = [
        { name: 'Businesses', value: stats?.tenants?.total || 0, icon: Building2 },
        { name: 'Users', value: stats?.users?.total || 0, icon: Users },
        { name: 'Bookings', value: stats?.bookings?.total || 0, icon: Calendar },
        { name: 'Conversations', value: stats?.conversations?.total || 0, icon: Inbox },
        { name: 'New this month', value: stats?.tenants?.newThisMonth || 0, icon: TrendingUp },
    ];

    return (
        <div className="space-y-8">
            <PageHeader
                title="Platform overview"
                subtitle={`${stats?.tenants?.active || 0} businesses active · ${stats?.bookings?.today || 0} bookings today`}
            />

            {/* What needs a person right now */}
            {can('attention:read') && <AttentionPanel />}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                {statCards.map((stat, index) => (
                    <StatCard
                        key={stat.name}
                        name={stat.name}
                        value={stat.value}
                        icon={<stat.icon aria-hidden />}
                        index={index}
                    />
                ))}
            </div>

            <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
                    <h2 className="text-section-heading text-text">Newest businesses</h2>
                    <Link href="/admin/tenants" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        See all <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                </div>
                {recentTenants && recentTenants.length === 0 ? (
                    <Empty>No businesses have signed up yet.</Empty>
                ) : (
                    <Table>
                        <THead>
                            <tr>
                                <Th>Name</Th>
                                <Th>Users</Th>
                                <Th>Bookings</Th>
                                <Th>WhatsApp</Th>
                                <Th>Status</Th>
                                <Th>Joined</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {recentTenants?.map((tenant: any) => (
                                <Tr key={tenant.id}>
                                    <Td>
                                        <Link href={`/admin/tenants/${tenant.id}`} className="font-semibold text-text hover:text-primary">
                                            {tenant.name}
                                        </Link>
                                    </Td>
                                    <Td label="Users" className="tabular-nums">{tenant.usersCount}</Td>
                                    <Td label="Bookings" className="tabular-nums">{tenant.bookingsCount}</Td>
                                    <Td label="WhatsApp">
                                        <StatusPill
                                            size="sm"
                                            status={tenant.whatsappConnected ? 'connected' : 'inactive'}
                                            label={tenant.whatsappConnected ? 'Connected' : 'Not connected'}
                                        />
                                    </Td>
                                    <Td label="Status">
                                        <StatusPill size="sm" status={tenant.isActive ? 'active' : 'inactive'} tone={tenant.isActive ? 'success' : 'error'} />
                                    </Td>
                                    <Td label="Joined" className="text-muted">{formatDate(tenant.createdAt)}</Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </div>
    );
}
