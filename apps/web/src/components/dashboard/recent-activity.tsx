'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarPlus, ChevronRight, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/lib/use-currency';
import {
    Avatar,
    EmptyState,
    ErrorState,
    SkeletonList,
    Stagger,
    StaggerItem,
    StatusPill,
    buttonVariants,
} from '@bookingflow/ui';
import { displayMoney } from '@/components/primitives/money';
import { useAuth } from '@/lib/auth';
import { BookingStatusPill } from '@/components/bookings/booking-status-pill';

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
 * Recent activity for the home page: the 5 latest orders (PRODUCT tenants)
 * or upcoming bookings (SERVICE tenants). One list layout at every width:
 * avatar, who, what, status, so phones never scroll sideways.
 */
export function RecentActivity() {
    const { tenant } = useAuth();
    const isProduct = tenant?.businessType === 'PRODUCT';

    return isProduct ? <RecentOrders /> : <RecentBookings />;
}

function SectionShell({
    title,
    href,
    linkLabel,
    children,
}: {
    title: string;
    href: string;
    linkLabel: string;
    children: React.ReactNode;
}) {
    return (
        <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card" aria-label={title}>
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                <h2 className="text-section-heading text-text">{title}</h2>
                <Link
                    href={href}
                    className="-mr-2 inline-flex min-h-[44px] items-center gap-1 rounded-control px-3 text-[15px] font-semibold text-primary transition-colors duration-ui hover:bg-primary-soft"
                >
                    {linkLabel}
                    <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
            </header>
            {children}
        </section>
    );
}

function LoadingRows({ label }: { label: string }) {
    return (
        <div aria-busy="true" className="px-4 sm:px-5">
            <span className="sr-only">{label}</span>
            <SkeletonList rows={4} />
        </div>
    );
}

function Row({ name, line, side }: { name: string; line: React.ReactNode; side: React.ReactNode }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
            <Avatar name={name} size="md" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-semibold text-text">{name}</p>
                <p className="truncate text-[14px] text-muted">{line}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-right">{side}</div>
        </div>
    );
}

function RecentOrders() {
    const currency = useTenantCurrency();
    const { data: orders = [], isLoading, isError, refetch, isRefetching } = useQuery<OrderRow[]>({
        queryKey: ['orders', 'recent'],
        queryFn: async () => (await api.get('/orders', { params: { limit: 5 } })).data.data,
        refetchInterval: 30_000,
    });

    return (
        <SectionShell title="Latest orders" href="/orders" linkLabel="See all">
            {isLoading ? (
                <LoadingRows label="Loading your latest orders…" />
            ) : isError ? (
                <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />
            ) : orders.length === 0 ? (
                <EmptyState
                    icon={<ShoppingBag />}
                    title="No orders yet"
                    description="Share your WhatsApp link so customers can order from you. New orders show up here."
                    action={<Link href="/products" className={buttonVariants()}>Check your products</Link>}
                />
            ) : (
                <Stagger as="ul" className="divide-y divide-border">
                    {orders.map((o) => (
                        <StaggerItem as="li" key={o.id}>
                            <Row
                                name={o.customerName}
                                line={<span className="tabular-nums">#{o.orderRef}</span>}
                                side={
                                    <>
                                        <span className="text-[15px] font-semibold tabular-nums text-text">
                                            {displayMoney(o.totalAmount, currency)}
                                        </span>
                                        <OrderStatusPill status={o.status} paymentStatus={o.paymentStatus} />
                                    </>
                                }
                            />
                        </StaggerItem>
                    ))}
                </Stagger>
            )}
        </SectionShell>
    );
}

function OrderStatusPill({ status, paymentStatus }: { status: OrderRow['status']; paymentStatus: OrderRow['paymentStatus'] }) {
    if (paymentStatus === 'PAID') return <StatusPill status="paid" size="sm" />;
    if (status === 'CANCELLED') return <StatusPill status="cancelled" size="sm" />;
    if (paymentStatus === 'REFUNDED') return <StatusPill status="refunded" size="sm" />;
    if (status === 'SHIPPED') return <StatusPill status="shipped" tone="success" size="sm" />;
    if (status === 'DELIVERED') return <StatusPill status="delivered" size="sm" />;
    return <StatusPill status="pending" size="sm" />;
}

function RecentBookings() {
    const { data: bookings = [], isLoading, isError, refetch, isRefetching } = useQuery<BookingRow[]>({
        queryKey: ['bookings', 'recent'],
        queryFn: async () =>
            (await api.get('/bookings', { params: { status: 'CONFIRMED', limit: 5 } })).data.data,
        refetchInterval: 30_000,
    });

    return (
        <SectionShell title="Coming up" href="/bookings" linkLabel="All bookings">
            {isLoading ? (
                <LoadingRows label="Loading your upcoming bookings…" />
            ) : isError ? (
                <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />
            ) : bookings.length === 0 ? (
                <EmptyState
                    icon={<CalendarPlus />}
                    title="No bookings yet"
                    description="Share your WhatsApp link to get your first one!"
                    action={<Link href="/services" className={buttonVariants()}>Check your services</Link>}
                />
            ) : (
                <Stagger as="ul" className="divide-y divide-border">
                    {bookings.map((b) => (
                        <StaggerItem as="li" key={b.id}>
                            <Row
                                name={b.customerName}
                                line={b.service.name}
                                side={
                                    <>
                                        <span className="whitespace-nowrap text-[14px] font-medium tabular-nums text-text">
                                            {format(new Date(b.startTime), 'EEE d MMM · h:mm a')}
                                        </span>
                                        <BookingStatusPill status={b.status} />
                                    </>
                                }
                            />
                        </StaggerItem>
                    ))}
                </Stagger>
            )}
        </SectionShell>
    );
}
