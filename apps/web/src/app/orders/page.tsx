'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
    Search, Filter, Package, Truck,
    CheckCircle, XCircle, Clock, DollarSign, Eye, Link2, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { paymentBadgeClass } from '@/lib/payment';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import { PageHeader } from '@/components/ui/page-header';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useProductRouteGuard } from '@/lib/use-product-route-guard';

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

export default function OrdersPage() {
    // PRODUCT mode is parked — bounce to /dashboard until the flag flips.
    const productEnabled = useProductRouteGuard();

    const queryClient = useQueryClient();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [resendingId, setResendingId] = useState<string | null>(null);

    const copyPaymentLink = async (order: Order, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!order.paymentAuthorizationUrl) {
            toast.error('No payment link on this order yet');
            return;
        }
        try {
            await navigator.clipboard.writeText(order.paymentAuthorizationUrl);
            toast.success('Payment link copied');
        } catch {
            toast.error('Could not copy — select the URL manually');
        }
    };

    const resendPaymentLink = async (order: Order, e: React.MouseEvent) => {
        e.stopPropagation();
        setResendingId(order.id);
        try {
            const res = await api.post(`/payments/orders/${order.id}/initialize`);
            await navigator.clipboard.writeText(res.data.authorizationUrl).catch(() => undefined);
            toast.success('New payment link copied');
            await queryClient.invalidateQueries({ queryKey: ['orders'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Could not generate a new link');
        } finally {
            setResendingId(null);
        }
    };

    const { data: orders = [], isLoading } = useQuery({
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
        order.customerName.toLowerCase().includes(search.toLowerCase()) ||
        (order.orderRef ?? order.orderNumber ?? '').toLowerCase().includes(search.toLowerCase()) ||
        order.customerPhone.includes(search)
    );

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PENDING': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-500/10 dark:text-yellow-400';
            case 'CONFIRMED': return 'text-blue-600 bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400';
            case 'PROCESSING': return 'text-purple-600 bg-purple-100 dark:bg-purple-500/10 dark:text-purple-400';
            case 'SHIPPED': return 'text-indigo-600 bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400';
            case 'DELIVERED': return 'text-emerald-600 bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400';
            case 'CANCELLED': return 'text-red-600 bg-red-100 dark:bg-red-500/10 dark:text-red-400';
            default: return 'text-slate-600 bg-slate-100 dark:bg-slate-500/10 dark:text-slate-400';
        }
    };

    if (!productEnabled) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <PageHeader
                title="Orders"
                subtitle="Track and manage customer orders"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    name="Total Orders"
                    value={stats.total}
                    icon={<Package className="w-6 h-6 text-blue-500" />}
                    color="bg-blue-500/10"
                    index={0}
                />
                <StatCard
                    name="Pending"
                    value={stats.pending}
                    icon={<Clock className="w-6 h-6 text-yellow-500" />}
                    color="bg-yellow-500/10"
                    index={1}
                />
                <StatCard
                    name="Revenue"
                    value={`$${Number(stats.revenue).toFixed(0)}`}
                    icon={<DollarSign className="w-6 h-6 text-emerald-500" />}
                    color="bg-emerald-500/10"
                    index={2}
                />
                <StatCard
                    name="Delivered"
                    value={stats.delivered}
                    icon={<Truck className="w-6 h-6 text-purple-500" />}
                    color="bg-purple-500/10"
                    index={3}
                />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center bg-white dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-xl">
                <div className="relative flex-1 w-full sm:max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                    <DashboardInput
                        placeholder="Search orders..."
                        className="pl-10 bg-transparent border-slate-200 dark:border-slate-700/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Filter className="w-4 h-4 text-slate-500" />
                    <select
                        className="bg-transparent border-none text-sm font-medium text-slate-700 dark:text-slate-300 focus:ring-0 cursor-pointer"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="ALL">All Status</option>
                        <option value="PENDING">Pending</option>
                        <option value="CONFIRMED">Confirmed</option>
                        <option value="PROCESSING">Processing</option>
                        <option value="SHIPPED">Shipped</option>
                        <option value="DELIVERED">Delivered</option>
                        <option value="CANCELLED">Cancelled</option>
                    </select>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/50 dark:bg-slate-700/20 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Order Ref</th>
                                <th className="px-6 py-4">Customer</th>
                                <th className="px-6 py-4">Date</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Payment</th>
                                <th className="px-6 py-4">Amount</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <BooklyDots size="sm" />
                                            <p>Loading orders...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Package className="w-8 h-8 text-slate-300" />
                                            <p>No orders found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredOrders.map((order: Order) => (
                                    <tr key={order.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer" onClick={() => handleViewOrder(order)}>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300 font-medium">
                                            {order.orderRef ?? order.orderNumber}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-slate-900 dark:text-white">{order.customerName}</div>
                                            <div className="text-xs text-slate-500">{order.customerPhone}</div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">
                                            {format(new Date(order.createdAt), 'MMM d, yyyy')}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(order.status)}`}>
                                                {order.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium ${paymentBadgeClass(order.paymentStatus)}`}>
                                                {order.paymentStatus}
                                            </span>
                                            {order.paymentStatus === 'UNPAID' && (
                                                <div className="flex items-center gap-1 mt-1.5">
                                                    {order.paymentAuthorizationUrl && (
                                                        <button
                                                            onClick={(e) => copyPaymentLink(order, e)}
                                                            className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
                                                            aria-label="Copy payment link"
                                                        >
                                                            <Link2 className="w-3 h-3" /> Copy link
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={(e) => resendPaymentLink(order, e)}
                                                        disabled={resendingId === order.id}
                                                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline disabled:opacity-50"
                                                        aria-label="Generate new payment link"
                                                    >
                                                        <RefreshCw className={`w-3 h-3 ${resendingId === order.id ? 'animate-spin' : ''}`} />
                                                        {resendingId === order.id ? 'Generating…' : 'New link'}
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 font-mono text-slate-900 dark:text-white font-medium">
                                            ${Number(order.totalAmount).toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={(e) => { e.stopPropagation(); handleViewOrder(order); }}>
                                                <Eye className="w-4 h-4 text-slate-500" />
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile: stacked order cards */}
                <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-700">
                    {isLoading ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <BooklyDots size="sm" />
                                <p>Loading orders...</p>
                            </div>
                        </div>
                    ) : filteredOrders.length === 0 ? (
                        <div className="px-4 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                                <Package className="w-8 h-8 text-slate-300" />
                                <p>No orders found</p>
                            </div>
                        </div>
                    ) : (
                        filteredOrders.map((order: Order) => (
                            <button
                                key={order.id}
                                onClick={() => handleViewOrder(order)}
                                className="w-full text-left p-4 active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-slate-900 dark:text-white truncate">{order.customerName}</p>
                                        <p className="text-xs text-slate-500 font-mono">{order.orderRef ?? order.orderNumber}</p>
                                    </div>
                                    <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white shrink-0">
                                        ${Number(order.totalAmount).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium ${getStatusColor(order.status)}`}>
                                        {order.status}
                                    </span>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium ${paymentBadgeClass(order.paymentStatus)}`}>
                                        {order.paymentStatus}
                                    </span>
                                    <span className="text-[11px] text-slate-400 ml-auto">
                                        {format(new Date(order.createdAt), 'MMM d, yyyy')}
                                    </span>
                                </div>
                                {order.paymentStatus === 'UNPAID' && (
                                    <div className="flex items-center gap-3 mt-2">
                                        {order.paymentAuthorizationUrl && (
                                            <span
                                                onClick={(e) => copyPaymentLink(order, e)}
                                                className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
                                            >
                                                <Link2 className="w-3 h-3" /> Copy link
                                            </span>
                                        )}
                                        <span
                                            onClick={(e) => resendPaymentLink(order, e)}
                                            className="inline-flex items-center gap-1 text-xs text-slate-500"
                                        >
                                            <RefreshCw className={`w-3 h-3 ${resendingId === order.id ? 'animate-spin' : ''}`} />
                                            {resendingId === order.id ? 'Generating…' : 'New link'}
                                        </span>
                                    </div>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>

            <OrderDetailsModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                order={selectedOrder}
            />
        </div>
    );
}
