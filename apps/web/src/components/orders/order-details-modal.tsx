'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Clock, MapPin, Phone, StickyNote } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/lib/use-currency';
import { Avatar, Button, ConfirmDialog, Modal, Select, TickPop, formatGhanaPhone } from '@bookingflow/ui';
import { notify as toast } from '@/components/brand/toast';
import { displayMoney } from '@/components/primitives/money';
import { ORDER_STATUS_LABEL, OrderStatusPill, PaymentPill, type OrderStatus } from './order-pills';

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
    const currency = useTenantCurrency();
    const [confirmCancel, setConfirmCancel] = useState(false);
    // The parent holds a snapshot; show the new status right after a save.
    const [savedStatus, setSavedStatus] = useState<OrderStatus | null>(null);
    const [tickKey, setTickKey] = useState(0);

    useEffect(() => {
        setSavedStatus(null);
        setTickKey(0);
        setConfirmCancel(false);
    }, [order?.id]);

    // Hooks must run unconditionally — the `!order` guard lives below all of
    // them. The mutationFns guard `order` themselves since they're defined
    // while `order` is still typed `Order | null`.
    const updateStatusMutation = useMutation({
        mutationFn: async (newStatus: string) => {
            if (!order) return;
            await api.patch(`/orders/${order.id}`, { status: newStatus });
        },
        onSuccess: (_data, newStatus) => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            setSavedStatus(newStatus as OrderStatus);
            if (newStatus === 'CONFIRMED' || newStatus === 'DELIVERED') setTickKey((k) => k + 1);
            toast.success(`Order marked as ${(ORDER_STATUS_LABEL[newStatus as OrderStatus] ?? 'updated').toLowerCase()}`);
        },
        onError: () => toast.error("Couldn't update the order. Try again."),
    });

    const cancelMutation = useMutation({
        mutationFn: async () => {
            if (!order) return;
            await api.post(`/orders/${order.id}/cancel`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            setSavedStatus('CANCELLED');
            toast.success('Order cancelled. The items are back in stock.');
        },
        onError: (err: any) => toast.error(err.response?.data?.message || "Couldn't cancel the order. Try again."),
        onSettled: () => setConfirmCancel(false),
    });

    if (!order) return null;

    const status = savedStatus ?? order.status;
    const locked = status === 'DELIVERED' || status === 'CANCELLED';

    const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStatus = e.target.value;
        if (newStatus === 'CANCELLED') {
            setConfirmCancel(true);
        } else {
            updateStatusMutation.mutate(newStatus);
        }
    };

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={`Order ${order.orderRef ?? order.orderNumber ?? ''}`}
                description={order.customerName}
                maxWidth="max-w-2xl"
                footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
            >
                <div className="space-y-5">
                    {tickKey > 0 && (
                        <div className="flex items-center gap-3 rounded-card bg-success-soft p-3 text-success-fg" role="status">
                            <TickPop key={tickKey} size={40} label={`Order ${ORDER_STATUS_LABEL[status].toLowerCase()}`} />
                            <p className="text-[15px] font-semibold">
                                {status === 'DELIVERED' ? 'Delivered. Your customer has their order!' : 'Order confirmed!'}
                            </p>
                        </div>
                    )}

                    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface-2 p-4 sm:flex-row sm:items-end sm:justify-between">
                        <div className="space-y-2">
                            <p className="flex items-center gap-2 text-[15px] tabular-nums text-muted">
                                <Clock className="h-4 w-4" aria-hidden />
                                {format(new Date(order.createdAt), 'EEE d MMM yyyy, h:mm a')}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <OrderStatusPill status={status} size="md" />
                                <PaymentPill status={order.paymentStatus} size="md" />
                            </div>
                        </div>
                        <div className="sm:w-56">
                            <Select
                                label="Update order"
                                value={status}
                                onChange={handleStatusChange}
                                disabled={locked || updateStatusMutation.isPending || cancelMutation.isPending}
                            >
                                {(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => (
                                    <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
                                ))}
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <section className="rounded-card border border-border p-4">
                            <h3 className="mb-3 text-[14px] font-semibold text-muted">Customer</h3>
                            <div className="flex items-center gap-3">
                                <Avatar name={order.customerName} size="md" />
                                <div className="min-w-0">
                                    <p className="truncate font-semibold text-text">{order.customerName}</p>
                                    <p className="flex items-center gap-1.5 text-[15px] tabular-nums text-muted">
                                        <Phone className="h-3.5 w-3.5" aria-hidden />
                                        {formatGhanaPhone(order.customerPhone)}
                                    </p>
                                </div>
                            </div>
                            {order.deliveryAddress && (
                                <p className="mt-3 flex items-start gap-2 text-[15px] text-text">
                                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                                    <span>{order.deliveryAddress}</span>
                                </p>
                            )}
                        </section>

                        <section className="rounded-card border border-border p-4">
                            <h3 className="mb-3 text-[14px] font-semibold text-muted">Payment</h3>
                            <dl className="space-y-2 text-[15px]">
                                <div className="flex items-center justify-between gap-3">
                                    <dt className="text-muted">Status</dt>
                                    <dd><PaymentPill status={order.paymentStatus} /></dd>
                                </div>
                                {order.paidAt && (
                                    <div className="flex items-center justify-between gap-3">
                                        <dt className="text-muted">Paid on</dt>
                                        <dd className="tabular-nums text-text">{format(new Date(order.paidAt), 'd MMM, h:mm a')}</dd>
                                    </div>
                                )}
                                <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                                    <dt className="font-semibold text-text">Total</dt>
                                    <dd className="text-[18px] font-bold tabular-nums text-text">{displayMoney(order.totalAmount, currency)}</dd>
                                </div>
                            </dl>
                        </section>
                    </div>

                    <section>
                        <h3 className="mb-2 text-[14px] font-semibold text-muted">What they ordered</h3>
                        <ul className="divide-y divide-border rounded-card border border-border">
                            {order.items.map((item) => (
                                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[15px]">
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-text">{item.product.name}</p>
                                        <p className="tabular-nums text-muted">
                                            {item.quantity} × {displayMoney(item.unitPrice, currency)}
                                        </p>
                                    </div>
                                    <span className="shrink-0 font-semibold tabular-nums text-text">
                                        {displayMoney(item.totalPrice, currency)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {order.notes && (
                        <section>
                            <h3 className="mb-2 text-[14px] font-semibold text-muted">Notes</h3>
                            <div className="flex gap-2 rounded-card bg-warning-soft p-3 text-[15px] text-text">
                                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden />
                                <p>{order.notes}</p>
                            </div>
                        </section>
                    )}
                </div>
            </Modal>

            <ConfirmDialog
                isOpen={confirmCancel}
                onClose={() => setConfirmCancel(false)}
                onConfirm={() => cancelMutation.mutate()}
                title="Cancel this order?"
                description="The items go back into your stock. You can't undo this."
                confirmLabel="Cancel order"
                cancelLabel="Keep order"
                isLoading={cancelMutation.isPending}
            />
        </>
    );
}
