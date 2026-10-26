'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Banknote, Clock, Link2, Package, RefreshCw, SearchX, ShoppingBag, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/lib/use-currency';
import {
    Button,
    EmptyState,
    FilterChips,
    PageHeader,
    ResponsiveTable,
    SearchInput,
    SkeletonList,
    StatCard,
    buttonVariants,
    type Column,
} from '@bookingflow/ui';
import { notify as toast } from '@/components/brand/toast';
import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import { OrderStatusPill, PaymentPill } from '@/components/orders/order-pills';
import { displayMoney } from '@/components/primitives/money';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';
import { QueryState } from '@/components/query-state';

interface Order {
    id: string;
    orderRef: string;
    orderNumber?: string; // legacy alias used by some older API responses
    customerName: string;
    customerPhone: string;
    status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
    paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
    paymentReference: string | null;
    paymentAuthorizationUrl: string | null;
    paidAt: string | null;
    totalAmount: number;
    items: any[];
    createdAt: string;
}

const STATUS_FILTERS = [
    { value: 'ALL', label: 'All' },
    { value: 'PENDING', label: 'New' },
    { value: 'CONFIRMED', label: 'Confirmed' },
    { value: 'PROCESSING', label: 'Getting ready' },
    { value: 'SHIPPED', label: 'On the way' },
    { value: 'DELIVERED', label: 'Delivered' },
    { value: 'CANCELLED', label: 'Cancelled' },
];

const PAYMENT_FILTERS = [
    { value: 'ANY', label: 'Any payment' },
    { value: 'PAID', label: 'Paid' },
    { value: 'UNPAID', label: 'Not paid' },
];

const LINK_BTN =
    'inline-flex min-h-[44px] items-center gap-1.5 rounded-control px-2 text-[14px] font-semibold transition-colors duration-ui disabled:opacity-50';

export default function OrdersPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const queryClient = useQueryClient();
    const currency = useTenantCurrency();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [paymentFilter, setPaymentFilter] = useState('ANY');
    const [resendingId, setResendingId] = useState<string | null>(null);

    const copyPaymentLink = async (order: Order, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!order.paymentAuthorizationUrl) {
            toast.error('This order has no payment link yet. Tap "New link" to make one.');
            return;
        }
        try {
            await navigator.clipboard.writeText(order.paymentAuthorizationUrl);
            toast.success('Payment link copied. Paste it in WhatsApp.');
        } catch {
            toast.error("Couldn't copy the link. Open the order and copy it by hand.");
        }
    };

    const resendPaymentLink = async (order: Order, e: React.MouseEvent) => {
        e.stopPropagation();
        setResendingId(order.id);
        try {
            const res = await api.post(`/payments/orders/${order.id}/initialize`);
            await navigator.clipboard.writeText(res.data.authorizationUrl).catch(() => undefined);
            toast.success('New payment link made and copied');
            await queryClient.invalidateQueries({ queryKey: ['orders'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? "Couldn't make a new link. Try again.");
        } finally {
            setResendingId(null);
        }
    };

    const { data: orders = [], isLoading, isError } = useQuery({
        queryKey: ['orders', statusFilter],
        queryFn: async () => {
            const params: any = {};
            if (statusFilter !== 'ALL') params.status = statusFilter;
            const res = await api.get('/orders', { params });
            return res.data.data;
        },
    });

    const { data: stats = { total: 0, pending: 0, confirmed: 0, delivered: 0, revenue: 0 } } = useQuery({
        queryKey: ['order-stats'],
        queryFn: async () => {
            const res = await api.get('/orders/stats');
            return res.data;
        },
    });

    const handleViewOrder = (order: Order) => {
        setSelectedOrder(order);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedOrder(null);
    };

    const filteredOrders = orders.filter((order: Order) =>
        (paymentFilter === 'ANY' || order.paymentStatus === paymentFilter) && (
            order.customerName.toLowerCase().includes(search.toLowerCase()) ||
            (order.orderRef ?? order.orderNumber ?? '').toLowerCase().includes(search.toLowerCase()) ||
            order.customerPhone.includes(search)
        )
    );

    if (!productEnabled) return null;

    const paymentCell = (order: Order) => (
        <div className="flex flex-col items-end gap-0.5 md:items-start">
            <PaymentPill status={order.paymentStatus} />
            {order.paymentStatus === 'UNPAID' && (
                <div className="-ml-2 flex flex-wrap items-center">
                    {order.paymentAuthorizationUrl && (
                        <button
                            type="button"
                            onClick={(e) => copyPaymentLink(order, e)}
                            className={`${LINK_BTN} text-primary hover:bg-primary-soft`}
                            aria-label="Copy payment link"
                        >
                            <Link2 className="h-4 w-4" aria-hidden /> Copy link
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => resendPaymentLink(order, e)}
                        disabled={resendingId === order.id}
                        className={`${LINK_BTN} text-muted hover:bg-surface-2 hover:text-text`}
                        aria-label="Generate new payment link"
                    >
                        <RefreshCw className={`h-4 w-4 ${resendingId === order.id ? 'animate-spin' : ''}`} aria-hidden />
                        {resendingId === order.id ? 'Making…' : 'New link'}
                    </button>
                </div>
            )}
        </div>
    );

    const columns: Column<Order>[] = [
        {
            key: 'customer',
            header: 'Customer',
            render: (o) => (
                <div className="min-w-0">
                    <div className="font-semibold text-text">{o.customerName}</div>
                    <div className="text-[14px] tabular-nums text-muted">{o.customerPhone}</div>
                </div>
            ),
        },
        {
            key: 'total',
            header: 'Total',
            align: 'right',
            render: (o) => <span className="font-semibold">{displayMoney(o.totalAmount, currency)}</span>,
        },
        { key: 'status', header: 'Order', render: (o) => <OrderStatusPill status={o.status} /> },
        { key: 'payment', header: 'Payment', render: paymentCell },
        {
            key: 'date',
            header: 'Date',
            render: (o) => <span className="whitespace-nowrap tabular-nums text-muted">{format(new Date(o.createdAt), 'd MMM yyyy')}</span>,
        },
        {
            key: 'ref',
            header: 'Order no.',
            hideOnMobile: true,
            render: (o) => <span className="text-[14px] tabular-nums text-muted">{o.orderRef ?? o.orderNumber}</span>,
        },
        {
            key: 'actions',
            header: 'Details',
            align: 'right',
            render: (o) => (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewOrder(o); }}>
                    View
                </Button>
            ),
        },
    ];

    const filtersActive = search.trim() !== '' || statusFilter !== 'ALL' || paymentFilter !== 'ANY';

    return (
        <div className="space-y-6 lg:space-y-8">
            <PageHeader
                title="Your orders"
                subtitle="Every order from your customers. Tap one to see what they bought and update it."
            />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard name="All orders" value={stats.total} icon={<Package />} index={0} />
                <StatCard name="New" value={stats.pending} icon={<Clock />} index={1} />
                <StatCard name="Sales" value={displayMoney(stats.revenue, currency, { compact: true })} icon={<Banknote />} index={2} />
                <StatCard name="Delivered" value={stats.delivered} icon={<Truck />} index={3} />
            </div>

            <div className="space-y-3">
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search orders"
                    placeholder="Search by name, phone or order no."
                    className="sm:max-w-md"
                />
                <FilterChips label="Filter orders by status" chips={STATUS_FILTERS} selected={[statusFilter]} onToggle={setStatusFilter} />
                <FilterChips label="Filter orders by payment" chips={PAYMENT_FILTERS} selected={[paymentFilter]} onToggle={setPaymentFilter} />
            </div>

            {/* A failed request must never render as an empty list — the business
                would read it as data loss. */}
            {isError ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <QueryState isLoading={false} isError onRetry={() => window.location.reload()}>
                        <></>
                    </QueryState>
                </div>
            ) : isLoading ? (
                <div aria-busy="true" className="rounded-card border border-border bg-surface px-4 shadow-card">
                    <span className="sr-only">Loading your orders…</span>
                    <SkeletonList rows={6} />
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    {filtersActive ? (
                        <EmptyState
                            icon={<SearchX />}
                            title="No orders match"
                            description="Try another name, or show all orders."
                            action={
                                <Button
                                    variant="secondary"
                                    onClick={() => { setSearch(''); setStatusFilter('ALL'); setPaymentFilter('ANY'); }}
                                >
                                    Show all orders
                                </Button>
                            }
                        />
                    ) : (
                        <EmptyState
                            icon={<ShoppingBag />}
                            title="No orders yet"
                            description="Share your WhatsApp link so customers can order from you. New orders land here."
                            action={<Link href="/channels" className={buttonVariants()}>Get your WhatsApp link</Link>}
                        />
                    )}
                </div>
            ) : (
                <ResponsiveTable caption="Your orders" columns={columns} rows={filteredOrders} rowKey={(o) => o.id} />
            )}

            <OrderDetailsModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                order={selectedOrder}
            />
        </div>
    );
}
