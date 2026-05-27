'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    Package, Truck, CheckCircle, XCircle, Clock, DollarSign,
    MapPin, Phone, User, AlertTriangle
} from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { toast } from 'react-hot-toast';

interface OrderItem {
    id: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    product: {
        name: string;
        imageUrl?: string;
    };
}

interface Order {
    id: string;
    orderRef: string; // Schema field — ORD-XXXXXX
    orderNumber?: string; // Legacy alias (older API responses)
    customerName: string;
    customerPhone: string;
    deliveryAddress?: string;
    status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
    paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
    paymentReference?: string | null;
    paymentAuthorizationUrl?: string | null;
    paidAt?: string | null;
    totalAmount: number;
    notes?: string;
    items: OrderItem[];
    createdAt: string;
}

interface OrderDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    promoOrder?: Order | null;
    orderId?: string | null; // Allow passing ID to fetch fresh if needed, but we usually pass the object
    order: Order | null;
}

export function OrderDetailsModal({ isOpen, onClose, order }: OrderDetailsModalProps) {
    const queryClient = useQueryClient();
    const [isUpdating, setIsUpdating] = useState(false);

    // Hooks must run unconditionally — the `!order` guard lives below all of
    // them. The mutationFns guard `order` themselves since they're defined
    // while `order` is still typed `Order | null`.
    const updateStatusMutation = useMutation({
        mutationFn: async (newStatus: string) => {
            if (!order) return;
            await api.patch(`/orders/${order.id}`, { status: newStatus });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast.success('Order status updated');
        },
        onError: () => toast.error('Failed to update status'),
    });

    const cancelMutation = useMutation({
        mutationFn: async () => {
            if (!order) return;
            await api.post(`/orders/${order.id}/cancel`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast.success('Order cancelled and stock restored');
        },
        onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to cancel order'),
    });

    if (!order) return null;

    const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStatus = e.target.value;
        if (newStatus === 'CANCELLED') {
            if (confirm('Are you sure? This will restore stock.')) {
                cancelMutation.mutate();
            }
        } else {
            updateStatusMutation.mutate(newStatus);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PENDING': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
            case 'CONFIRMED': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            case 'PROCESSING': return 'text-purple-500 bg-purple-500/10 border-purple-500/20';
            case 'SHIPPED': return 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20';
            case 'DELIVERED': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'CANCELLED': return 'text-red-500 bg-red-500/10 border-red-500/20';
            default: return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
        }
    };

    const getPaymentColor = (status: string) => {
        switch (status) {
            case 'PAID': return 'text-emerald-500';
            case 'REFUNDED': return 'text-orange-500';
            default: return 'text-red-500';
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Order ${order.orderRef ?? order.orderNumber ?? ''}`}
            maxWidth="max-w-2xl"
        >
            <div className="space-y-6">
                {/* Header Info */}
                <div className="flex flex-col sm:flex-row justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Clock className="w-4 h-4" />
                            {format(new Date(order.createdAt), 'PPP p')}
                        </div>
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(order.status)}`}>
                            {order.status}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Update Status:</label>
                        <select
                            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500"
                            value={order.status}
                            onChange={handleStatusChange}
                            disabled={order.status === 'DELIVERED' || order.status === 'CANCELLED'}
                        >
                            <option value="PENDING">Pending</option>
                            <option value="CONFIRMED">Confirmed</option>
                            <option value="PROCESSING">Processing</option>
                            <option value="SHIPPED">Shipped</option>
                            <option value="DELIVERED">Delivered</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Customer Details */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                            <User className="w-4 h-4 text-emerald-500" />
                            Customer Details
                        </h3>
                        <div className="space-y-2 text-sm">
                            <p className="flex items-center gap-2">
                                <span className="text-slate-500">Name:</span>
                                <span className="font-medium text-slate-900 dark:text-white">{order.customerName}</span>
                            </p>
                            <p className="flex items-center gap-2">
                                <Phone className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-700 dark:text-slate-300">{order.customerPhone}</span>
                            </p>
                            {order.deliveryAddress && (
                                <div className="flex items-start gap-2">
                                    <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                                    <span className="text-slate-700 dark:text-slate-300">{order.deliveryAddress}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Payment & Total */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-emerald-500" />
                            Payment
                        </h3>
                        <div className="space-y-2 text-sm">
                            <p className="flex items-center justify-between">
                                <span className="text-slate-500">Status:</span>
                                <span className={`font-medium ${getPaymentColor(order.paymentStatus)}`}>
                                    {order.paymentStatus}
                                </span>
                            </p>
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 mt-2">
                                <p className="flex items-center justify-between text-lg font-bold text-slate-900 dark:text-white">
                                    <span>Total:</span>
                                    <span>${Number(order.totalAmount).toFixed(2)}</span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Items */}
                <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <Package className="w-4 h-4 text-emerald-500" />
                        Order Items
                    </h3>
                    <div className="bg-slate-50 dark:bg-slate-700/20 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-700/40">
                                <tr>
                                    <th className="px-4 py-2 text-left text-slate-500 font-medium">Product</th>
                                    <th className="px-4 py-2 text-center text-slate-500 font-medium">Qty</th>
                                    <th className="px-4 py-2 text-right text-slate-500 font-medium">Price</th>
                                    <th className="px-4 py-2 text-right text-slate-500 font-medium">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {order.items.map((item) => (
                                    <tr key={item.id}>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900 dark:text-white">
                                                {item.product.name}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">
                                            {item.quantity}
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                                            ${Number(item.unitPrice).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">
                                            ${Number(item.totalPrice).toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Notes */}
                {order.notes && (
                    <div className="bg-yellow-50 dark:bg-yellow-500/10 p-4 rounded-xl border border-yellow-200 dark:border-yellow-500/20">
                        <h4 className="flex items-center gap-2 text-sm font-medium text-yellow-800 dark:text-yellow-400 mb-1">
                            <AlertTriangle className="w-4 h-4" /> Notes
                        </h4>
                        <p className="text-sm text-yellow-900 dark:text-yellow-200">{order.notes}</p>
                    </div>
                )}

                <div className="flex justify-end pt-4">
                    <Button onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
