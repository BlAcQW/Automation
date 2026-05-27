'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

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
        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 shadow-card overflow-hidden">
            <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200/80 dark:border-slate-700/80">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
                <Link
                    href={href}
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
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
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                tone === 'emerald' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
                tone === 'amber' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
                tone === 'slate' && 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                tone === 'rose' && 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
                tone === 'blue' && 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
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
                                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-700/80">
                                    <th className="px-5 py-3">Order ID</th>
                                    <th className="px-5 py-3">Customer</th>
                                    <th className="px-5 py-3">Status</th>
                                    <th className="px-5 py-3 text-right">Total</th>
                                    <th className="px-5 py-3 w-10" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/70">
                                {orders.map((o) => (
                                    <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-5 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                                            #{o.orderRef}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <Avatar name={o.customerName} size="sm" />
                                                <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                                    {o.customerName}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3"><OrderStatusPill status={o.status} paymentStatus={o.paymentStatus} /></td>
                                        <td className="px-5 py-3 text-right font-mono text-sm font-semibold text-slate-900 dark:text-white">
                                            ${Number(o.totalAmount).toFixed(2)}
                                        </td>
                                        <td className="px-5 py-3 text-right text-slate-400">
                                            <MoreHorizontal className="h-4 w-4 inline" />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <ul className="md:hidden divide-y divide-slate-200/70 dark:divide-slate-700/70">
                        {orders.map((o) => (
                            <li key={o.id} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <Avatar name={o.customerName} size="md" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                            {o.customerName}
                                        </p>
                                        <p className="text-xs text-slate-500 font-mono">#{o.orderRef}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
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
    if (status === 'SHIPPED' || status === 'DELIVERED') return <StatusPill tone="blue">{status.toLowerCase()}</StatusPill>;
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
                                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-700/80">
                                    <th className="px-5 py-3">Reference</th>
                                    <th className="px-5 py-3">Customer</th>
                                    <th className="px-5 py-3">Service</th>
                                    <th className="px-5 py-3">When</th>
                                    <th className="px-5 py-3 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/70">
                                {bookings.map((b) => (
                                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-5 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                                            {b.bookingReference}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <Avatar name={b.customerName} size="sm" />
                                                <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                                    {b.customerName}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-sm text-slate-600 dark:text-slate-300 truncate">
                                            {b.service.name}
                                        </td>
                                        <td className="px-5 py-3 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
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

                    <ul className="md:hidden divide-y divide-slate-200/70 dark:divide-slate-700/70">
                        {bookings.map((b) => (
                            <li key={b.id} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <Avatar name={b.customerName} size="md" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                            {b.customerName}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate">{b.service.name}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 whitespace-nowrap">
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
    return <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{text}</div>;
}
