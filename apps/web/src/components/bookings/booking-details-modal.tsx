'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calendar, Clock, Phone, StickyNote } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantCurrency } from '@/lib/use-currency';
import { Avatar, Button, ConfirmDialog, Modal, Select, TickPop, formatGhanaPhone } from '@bookingflow/ui';
import { notify as toast } from '@/components/brand/toast';
import { displayMoney } from '@/components/primitives/money';
import { BookingStatusPill, type BookingStatus } from './booking-status-pill';

interface Booking {
    id: string;
    bookingReference: string;
    customerName: string;
    customerPhone: string;
    startTime: string;
    endTime: string;
    status: BookingStatus;
    paymentStatus?: 'UNPAID' | 'PAID' | 'REFUNDED';
    paymentReference?: string | null;
    paymentAuthorizationUrl?: string | null;
    paidAt?: string | null;
    depositAmount?: number | string | null;
    notes?: string;
    service: {
        name: string;
        price: number;
        durationMinutes: number;
    };
}

interface BookingDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    booking: Booking | null;
}

const STATUS_WORDS: Record<string, string> = {
    CONFIRMED: 'confirmed',
    COMPLETED: 'done',
    NO_SHOW: "didn't come",
    CANCELLED: 'cancelled',
};

/** What each change means, in plain words, for the confirmation dialog. */
const CONFIRM_COPY: Record<string, { title: string; description: string; label: string; destructive: boolean }> = {
    CANCELLED: {
        title: 'Cancel this booking?',
        description: 'The time slot opens up again for other customers. You can’t undo this.',
        label: 'Cancel booking',
        destructive: true,
    },
    NO_SHOW: {
        title: "Mark as didn't come?",
        description: 'Use this when the customer missed their booking.',
        label: "Mark didn't come",
        destructive: true,
    },
    COMPLETED: {
        title: 'Mark this booking as done?',
        description: 'Great work! This moves it to your finished bookings.',
        label: 'Mark as done',
        destructive: false,
    },
    CONFIRMED: {
        title: 'Confirm this booking?',
        description: 'The booking will show as confirmed.',
        label: 'Confirm booking',
        destructive: false,
    },
};

export function BookingDetailsModal({ isOpen, onClose, booking }: BookingDetailsModalProps) {
    const queryClient = useQueryClient();
    const currency = useTenantCurrency();
    const [pendingStatus, setPendingStatus] = useState<string | null>(null);
    // The parent holds a snapshot of the booking; show the new status straight away after a save.
    const [savedStatus, setSavedStatus] = useState<string | null>(null);
    const [tickKey, setTickKey] = useState(0);

    useEffect(() => {
        setSavedStatus(null);
        setTickKey(0);
        setPendingStatus(null);
    }, [booking?.id]);

    // Hooks must run unconditionally — the `!booking` guard lives below the
    // hook. The mutationFn guards `booking` itself since it's defined while
    // `booking` is still typed `Booking | null`.
    const updateStatusMutation = useMutation({
        mutationFn: async (status: string) => {
            if (!booking) return;
            await api.patch(`/bookings/${booking.id}`, { status });
        },
        onSuccess: (_data, status) => {
            queryClient.invalidateQueries({ queryKey: ['bookings'] });
            setSavedStatus(status);
            if (status === 'CONFIRMED' || status === 'COMPLETED') setTickKey((k) => k + 1);
            toast.success(`Booking marked as ${STATUS_WORDS[status] ?? 'updated'}`);
        },
        onError: () => toast.error("Couldn't change the booking. Try again."),
        onSettled: () => setPendingStatus(null),
    });

    if (!booking) return null;

    const status = (savedStatus ?? booking.status) as BookingStatus;
    const confirmCopy = pendingStatus ? CONFIRM_COPY[pendingStatus] : null;

    const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStatus = e.target.value;
        if (newStatus !== status) setPendingStatus(newStatus);
    };

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={booking.customerName}
                description={`Booking ${booking.bookingReference}`}
                maxWidth="max-w-lg"
                footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
            >
                <div className="space-y-5">
                    {tickKey > 0 && (
                        <div className="flex items-center gap-3 rounded-card bg-success-soft p-3 text-success-fg" role="status">
                            <TickPop key={tickKey} size={40} label={`Booking ${STATUS_WORDS[status] ?? 'updated'}`} />
                            <p className="text-[15px] font-semibold">
                                {status === 'COMPLETED' ? 'Marked as done. Nice work!' : 'Booking confirmed!'}
                            </p>
                        </div>
                    )}

                    {/* When */}
                    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 font-semibold text-text">
                                <Calendar className="h-4 w-4 text-primary" aria-hidden />
                                {format(new Date(booking.startTime), 'EEEE d MMMM')}
                            </div>
                            <div className="flex items-center gap-2 text-[15px] tabular-nums text-muted">
                                <Clock className="h-4 w-4" aria-hidden />
                                {format(new Date(booking.startTime), 'h:mm a')} – {format(new Date(booking.endTime), 'h:mm a')}
                            </div>
                        </div>
                        <BookingStatusPill status={status} size="md" />
                    </div>

                    <Select
                        label="Change status"
                        value={status}
                        onChange={handleStatusChange}
                        disabled={status === 'CANCELLED' || updateStatusMutation.isPending}
                        hint={status === 'CANCELLED' ? 'Cancelled bookings can’t be changed.' : undefined}
                    >
                        {status === 'PENDING_PAYMENT' && <option value="PENDING_PAYMENT">Awaiting payment</option>}
                        <option value="CONFIRMED">Confirmed</option>
                        <option value="COMPLETED">Done</option>
                        <option value="NO_SHOW">Didn&apos;t come</option>
                        <option value="CANCELLED">Cancelled</option>
                    </Select>

                    {/* Customer */}
                    <section>
                        <h3 className="mb-2 text-[14px] font-semibold text-muted">Customer</h3>
                        <div className="flex items-center gap-3 rounded-card border border-border p-3">
                            <Avatar name={booking.customerName} size="md" />
                            <div className="min-w-0">
                                <p className="truncate font-semibold text-text">{booking.customerName}</p>
                                <p className="flex items-center gap-1.5 text-[15px] tabular-nums text-muted">
                                    <Phone className="h-3.5 w-3.5" aria-hidden />
                                    {formatGhanaPhone(booking.customerPhone)}
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Service */}
                    <section>
                        <h3 className="mb-2 text-[14px] font-semibold text-muted">Service</h3>
                        <dl className="space-y-2 rounded-card border border-border p-4 text-[15px]">
                            <div className="flex items-center justify-between gap-3">
                                <dt className="text-muted">Service</dt>
                                <dd className="text-right font-semibold text-text">{booking.service.name}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <dt className="text-muted">How long</dt>
                                <dd className="tabular-nums text-text">{booking.service.durationMinutes} min</dd>
                            </div>
                            {booking.depositAmount ? (
                                <div className="flex items-center justify-between gap-3">
                                    <dt className="text-muted">Deposit</dt>
                                    <dd className="tabular-nums text-text">{displayMoney(booking.depositAmount, currency)}</dd>
                                </div>
                            ) : null}
                            <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                                <dt className="font-semibold text-text">Price</dt>
                                <dd className="font-bold tabular-nums text-primary">{displayMoney(booking.service.price, currency)}</dd>
                            </div>
                        </dl>
                    </section>

                    {booking.notes && (
                        <section>
                            <h3 className="mb-2 text-[14px] font-semibold text-muted">Notes</h3>
                            <div className="flex gap-2 rounded-card bg-warning-soft p-3 text-[15px] text-text">
                                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden />
                                <p>{booking.notes}</p>
                            </div>
                        </section>
                    )}
                </div>
            </Modal>

            <ConfirmDialog
                isOpen={!!confirmCopy}
                onClose={() => setPendingStatus(null)}
                onConfirm={() => pendingStatus && updateStatusMutation.mutate(pendingStatus)}
                title={confirmCopy?.title ?? ''}
                description={confirmCopy?.description}
                confirmLabel={confirmCopy?.label}
                cancelLabel={confirmCopy?.destructive ? 'Keep booking' : 'Not now'}
                destructive={confirmCopy?.destructive ?? false}
                isLoading={updateStatusMutation.isPending}
            />
        </>
    );
}
