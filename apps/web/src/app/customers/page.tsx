'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, ShoppingBag, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import {
    Avatar,
    Button,
    StatCard,
    PageHeader,
    SearchInput,
    EmptyState,
    ErrorState,
    ResponsiveTable,
    SkeletonList,
    type Column,
} from '@bookingflow/ui';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';
import { MaskedContact } from '@/components/ui/masked-contact';
import { displayMoney } from '@/components/primitives/money';

interface Customer {
    id: string; // phone
    name: string;
    phone: string;
    contactMasked?: boolean;
    conversationId: string;
    lastActive: string;
    totalOrders: number;
    totalSpent: number;
    totalBookings: number;
}

const columns: Column<Customer>[] = [
    {
        key: 'name',
        header: 'Customer',
        render: (c) => (
            <span className="flex min-w-0 items-center gap-3">
                <Avatar name={c.name} size="sm" />
                <span className="truncate font-semibold text-text">{c.name}</span>
            </span>
        ),
    },
    {
        key: 'contact',
        header: 'Phone',
        render: (c) => (
            <span className="tabular-nums text-muted">
                <MaskedContact value={c.phone} masked={c.contactMasked} scope="conversation" recordId={c.conversationId} />
            </span>
        ),
    },
    {
        key: 'orders',
        header: 'Orders',
        align: 'right',
        hideOnMobile: true,
        render: (c) => c.totalOrders,
    },
    {
        key: 'spent',
        header: 'Spent',
        align: 'right',
        render: (c) => <span className="font-semibold">{displayMoney(c.totalSpent)}</span>,
    },
    {
        key: 'bookings',
        header: 'Bookings',
        align: 'right',
        hideOnMobile: true,
        render: (c) => c.totalBookings,
    },
    {
        key: 'lastActive',
        header: 'Last seen',
        render: (c) => <span className="text-muted">{format(new Date(c.lastActive), 'MMM d, yyyy')}</span>,
    },
];

export default function CustomersPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const [search, setSearch] = useState('');

    const { data: customersResponse, isLoading, isError, refetch, isRefetching } = useQuery({
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
        <div className="space-y-6 lg:space-y-8">
            <PageHeader
                title="Your customers"
                subtitle="Everyone who has chatted, ordered or booked with you."
            />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                <StatCard name="Customers" value={stats.totalCustomers} icon={<Users />} index={0} />
                <StatCard name="Active this month" value={stats.activeThisMonth} icon={<MessageSquare />} index={1} />
                <StatCard name="Orders" value={stats.totalOrders} icon={<ShoppingBag />} index={2} className="col-span-2 sm:col-span-1" />
            </div>

            <SearchInput
                value={search}
                onChange={setSearch}
                label="Search customers"
                placeholder="Search by name or phone…"
                className="w-full sm:max-w-md"
            />

            {isError ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />
                </div>
            ) : isLoading ? (
                <div aria-busy="true" className="rounded-card border border-border bg-surface px-4 shadow-card">
                    <span className="sr-only">Loading…</span>
                    <SkeletonList rows={6} />
                </div>
            ) : customers.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    {search ? (
                        <EmptyState
                            icon={<Users />}
                            title="No one matches that search"
                            description="Check the spelling, or search by phone number instead."
                            action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>}
                        />
                    ) : (
                        <EmptyState
                            icon={<Users />}
                            title="No customers yet"
                            description="When someone messages you on WhatsApp, they'll show up here."
                            action={
                                <Link
                                    href="/conversations"
                                    className="inline-flex min-h-[44px] items-center rounded-control bg-primary px-5 text-[15px] font-semibold text-primary-fg shadow-soft transition-colors duration-ui hover:bg-primary-hover"
                                >
                                    Go to your inbox
                                </Link>
                            }
                        />
                    )}
                </div>
            ) : (
                <ResponsiveTable
                    caption="Your customers"
                    columns={columns}
                    rows={customers}
                    rowKey={(c) => c.id}
                />
            )}
        </div>
    );
}
