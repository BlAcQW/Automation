'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar, cn } from '@bookingflow/ui';

interface OrderRow {
    id: string;
    orderRef: string;
    customerName: string;
    status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
    paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
    totalAmount: number | string;
    createdAt: string;
}

interface BookingRow {
    id: string;
    bookingReference: string;
    customerName: string;
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
    startTime: string;
    service: { name: string };
}

/**
 * Recent-activity table for the Overview page. Shows the 5 latest orders
 * (PRODUCT tenants) or bookings (SERVICE tenants) with avatar + status pill.
 * Mobile collapses to stacked cards instead of a horizontal table.
 */
export function RecentActivity() {
    const { tenant } = useAuth();
    const isProduct = tenant?.businessType === 'PRODUCT';

    return isProduct ? <RecentOrders /> : <RecentBookings />;
}

function SectionShell({
    title,
    href,
    children,
}: {
    title: string;
    href: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl bg-ink-900 shadow-card overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-ink-50/[0.08]">
                <h2 className="text-[15px] font-medium tracking-[-0.02em] text-ink-50">{title}</h2>
                <Link
                    href={href}
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 -mr-1.5 text-xs font-medium text-forest-brand dark:text-bookly-emerald-300 hover:bg-ink-50/[0.05] transition-colors"
                >
                    View all <ChevronRight className="h-3.5 w-3.5" />
                </Link>
            </header>
            {children}
        </section>
    );
}

function StatusPill({ tone, children }: { tone: 'emerald' | 'amber' | 'slate' | 'rose' | 'blue'; children: React.ReactNode }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded px-2 py-0.5 text-[11px] leading-[18px] font-medium',
                tone === 'emerald' && 'bg-bookly-emerald-100 text-bookly-emerald-700 dark:bg-bookly-emerald-500/20 dark:text-bookly-emerald-200',
                tone === 'amber' && 'bg-[#F1E3C2] text-[#7A5512] dark:bg-forest-glow/15 dark:text-forest-glow',
                tone === 'slate' && 'bg-ink-800 text-ink-200',
                tone === 'rose' && 'bg-[#F0D9D5] text-[#962F25] dark:bg-[#B03A2E]/25 dark:text-[#F0B8B0]',
                tone === 'blue' && 'bg-[#DDE4EA] text-[#2C4A63] dark:bg-[#2C4A63]/40 dark:text-[#B9CCDD]',
            )}
        >
            {children}
        </span>
    );
}

function RecentOrders() {
    const { data: orders = [], isLoading } = useQuery<OrderRow[]>({
        queryKey: ['orders', 'recent'],
        queryFn: async () => (await api.get('/orders', { params: { limit: 5 } })).data.data,
        refetchInterval: 30_000,
    });

    return (
        <SectionShell title="Recent Orders" href="/orders">
            {isLoading ? (
                <EmptyOrLoading text="Loading orders…" />
            ) : orders.length === 0 ? (
                <EmptyOrLoading text="No orders yet" />
            ) : (
                <>
                    {/* Desktop / tablet table */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[12px] font-medium text-ink-400 border-b border-ink-50/[0.08]">
                                    <th className="px-5 py-3">Order ID</th>
                                    <th className="px-5 py-3">Customer</th>
                                    <th className="px-5 py-3">Status</th>
                                    <th className="px-5 py-3 text-right">Total</th>
                                    <th className="px-5 py-3 w-10" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ink-50/[0.06]">
                                {orders.map((o) => (
                                    <tr key={o.id} className="hover:bg-ink-50/[0.03] transition-colors">
                                        <td className="px-5 py-3 font-mono text-xs text-ink-300">
                                            #{o.orderRef}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <Avatar name={o.customerName} size="sm" />
                                                <span className="text-sm font-medium tracking-[-0.01em] text-ink-50 truncate">
                                                    {o.customerName}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3"><OrderStatusPill status={o.status} paymentStatus={o.paymentStatus} /></td>
                                        <td className="px-5 py-3 text-right text-sm font-medium tabular-nums text-ink-50">
                                            ${Number(o.totalAmount).toFixed(2)}
                                        </td>
                                        <td className="px-5 py-3 text-right text-ink-400">
                                            <MoreHorizontal className="h-4 w-4 inline" />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <ul className="md:hidden divide-y divide-ink-50/[0.06]">
                        {orders.map((o) => (
                            <li key={o.id} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <Avatar name={o.customerName} size="md" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium tracking-[-0.01em] text-ink-50 truncate">
                                            {o.customerName}
                                        </p>
                                        <p className="text-xs text-ink-400 font-mono">#{o.orderRef}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-medium tabular-nums text-ink-50">
                                            ${Number(o.totalAmount).toFixed(2)}
                                        </p>
                                        <div className="mt-0.5">
                                            <OrderStatusPill status={o.status} paymentStatus={o.paymentStatus} />
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </SectionShell>
    );
}

function OrderStatusPill({ status, paymentStatus }: { status: OrderRow['status']; paymentStatus: OrderRow['paymentStatus'] }) {
    if (paymentStatus === 'PAID') return <StatusPill tone="emerald">Paid</StatusPill>;
    if (status === 'CANCELLED') return <StatusPill tone="slate">Cancelled</StatusPill>;
    if (paymentStatus === 'REFUNDED') return <StatusPill tone="rose">Refunded</StatusPill>;
    if (status === 'SHIPPED' || status === 'DELIVERED') return <StatusPill tone="blue">{status === 'SHIPPED' ? 'Shipped' : 'Delivered'}</StatusPill>;
    return <StatusPill tone="amber">Pending</StatusPill>;
}

function RecentBookings() {
    const { data: bookings = [], isLoading } = useQuery<BookingRow[]>({
        queryKey: ['bookings', 'recent'],
        queryFn: async () =>
            (await api.get('/bookings', { params: { status: 'CONFIRMED', limit: 5 } })).data.data,
        refetchInterval: 30_000,
    });

    return (
        <SectionShell title="Upcoming Bookings" href="/bookings">
            {isLoading ? (
                <EmptyOrLoading text="Loading bookings…" />
            ) : bookings.length === 0 ? (
                <EmptyOrLoading text="No upcoming bookings" />
            ) : (
                <>
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[12px] font-medium text-ink-400 border-b border-ink-50/[0.08]">
                                    <th className="px-5 py-3">Reference</th>
                                    <th className="px-5 py-3">Customer</th>
                                    <th className="px-5 py-3">Service</th>
                                    <th className="px-5 py-3">When</th>
                                    <th className="px-5 py-3 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ink-50/[0.06]">
                                {bookings.map((b) => (
                                    <tr key={b.id} className="hover:bg-ink-50/[0.03] transition-colors">
                                        <td className="px-5 py-3 font-mono text-xs text-ink-300">
                                            {b.bookingReference}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <Avatar name={b.customerName} size="sm" />
                                                <span className="text-sm font-medium tracking-[-0.01em] text-ink-50 truncate">
                                                    {b.customerName}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-sm text-ink-300 truncate">
                                            {b.service.name}
                                        </td>
                                        <td className="px-5 py-3 text-sm text-ink-300 whitespace-nowrap">
                                            {format(new Date(b.startTime), 'MMM d · h:mm a')}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <BookingStatusPill status={b.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <ul className="md:hidden divide-y divide-ink-50/[0.06]">
                        {bookings.map((b) => (
                            <li key={b.id} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <Avatar name={b.customerName} size="md" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium tracking-[-0.01em] text-ink-50 truncate">
                                            {b.customerName}
                                        </p>
                                        <p className="text-xs text-ink-400 truncate">{b.service.name}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-ink-400 tabular-nums whitespace-nowrap">
                                            {format(new Date(b.startTime), 'MMM d · h:mm a')}
                                        </p>
                                        <div className="mt-0.5">
                                            <BookingStatusPill status={b.status} />
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </SectionShell>
    );
}

function BookingStatusPill({ status }: { status: BookingRow['status'] }) {
    switch (status) {
        case 'CONFIRMED':
            return <StatusPill tone="emerald">Confirmed</StatusPill>;
        case 'COMPLETED':
            return <StatusPill tone="blue">Completed</StatusPill>;
        case 'CANCELLED':
        case 'NO_SHOW':
            return <StatusPill tone="slate">{status === 'NO_SHOW' ? 'No show' : 'Cancelled'}</StatusPill>;
        default:
            return <StatusPill tone="amber">Pending</StatusPill>;
    }
}

function EmptyOrLoading({ text }: { text: string }) {
    return <div className="px-5 py-10 text-center text-sm text-ink-400">{text}</div>;
}
