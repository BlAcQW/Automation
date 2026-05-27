'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    Calendar, Clock, User, Phone, MapPin, CheckCircle,
    XCircle, AlertTriangle, FileText
} from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { toast } from 'react-hot-toast';

interface Booking {
    id: string;
    bookingReference: string;
    customerName: string;
    customerPhone: string;
    startTime: string;
    endTime: string;
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
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

export function BookingDetailsModal({ isOpen, onClose, booking }: BookingDetailsModalProps) {
    const queryClient = useQueryClient();

    // Hooks must run unconditionally — the `!booking` guard lives below the
    // hook. The mutationFn guards `booking` itself since it's defined while
    // `booking` is still typed `Booking | null`.
    const updateStatusMutation = useMutation({
        mutationFn: async (status: string) => {
            if (!booking) return;
            await api.patch(`/bookings/${booking.id}`, { status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['bookings'] });
            toast.success('Booking status updated');
        },
        onError: () => toast.error('Failed to update status'),
    });

    if (!booking) return null;

    const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStatus = e.target.value;
        if (confirm(`Change status to ${newStatus}?`)) {
            updateStatusMutation.mutate(newStatus);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'CONFIRMED': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'CANCELLED': return 'text-red-500 bg-red-500/10 border-red-500/20';
            case 'COMPLETED': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            case 'NO_SHOW': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
            default: return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Booking ${booking.bookingReference}`}
            maxWidth="max-w-lg"
        >
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
                            <Calendar className="w-4 h-4 text-emerald-500" />
                            {format(new Date(booking.startTime), 'EEEE, MMMM d')}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Clock className="w-4 h-4" />
                            {format(new Date(booking.startTime), 'h:mm a')} - {format(new Date(booking.endTime), 'h:mm a')}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            value={booking.status}
                            onChange={handleStatusChange}
                            disabled={booking.status === 'CANCELLED'}
                        >
                            <option value="CONFIRMED">Confirmed</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="NO_SHOW">No Show</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </div>
                </div>

                <div className="space-y-4">
                    {/* Customer */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Customer</h3>
                        <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold">
                                {booking.customerName.charAt(0)}
                            </div>
                            <div>
                                <p className="font-medium text-slate-900 dark:text-white">{booking.customerName}</p>
                                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                                    <Phone className="w-3.5 h-3.5" />
                                    {booking.customerPhone}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Service */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Service Details</h3>
                        <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-slate-600 dark:text-slate-300">Service</span>
                                <span className="font-medium text-slate-900 dark:text-white">{booking.service.name}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-600 dark:text-slate-300">Duration</span>
                                <span className="text-slate-900 dark:text-white">{booking.service.durationMinutes} min</span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-700">
                                <span className="font-medium text-slate-900 dark:text-white">Price</span>
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">${Number(booking.service.price).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Notes */}
                    {booking.notes && (
                        <div>
                            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">Notes</h3>
                            <div className="p-3 bg-yellow-50 dark:bg-yellow-500/10 rounded-xl border border-yellow-200 dark:border-yellow-500/20 text-sm text-yellow-800 dark:text-yellow-200 flex gap-2">
                                <FileText className="w-4 h-4 shrink-0 mt-0.5" />
                                <p>{booking.notes}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-2">
                    <Button variant="ghost" onClick={onClose}>Close</Button>
                </div>
            </div>
        </Modal>
    );
}
