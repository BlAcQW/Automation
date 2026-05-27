'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
    Calendar, Search, Filter, Clock, MapPin,
    MoreHorizontal, CheckCircle, XCircle, AlertCircle,
    Link2, RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { paymentBadgeClass } from '@/lib/payment';
import { Button } from '@/components/ui/button';
import { DashboardInput } from '@/components/ui/input';
import { StatCard } from '@/components/ui/stat-card';
import { BookingDetailsModal } from '@/components/bookings/booking-details-modal';

interface Booking {
    id: string;
    bookingReference: string;
    customerName: string;
    customerPhone: string;
    startTime: string;
    endTime: string;
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
    paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
    paymentReference: string | null;
    paymentAuthorizationUrl: string | null;
    paidAt: string | null;
    depositAmount: number | string | null;
    notes?: string;
    service: {
        id: string;
        name: string;
        price: number;
        durationMinutes: number;
    };
}

export default function BookingsPage() {
    const queryClient = useQueryClient();
    const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
    const [search, setSearch] = useState('');
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [resendingId, setResendingId] = useState<string | null>(null);

    const copyPaymentLink = async (booking: Booking, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!booking.paymentAuthorizationUrl) {
            toast.error('No payment link on this booking yet');
            return;
        }
        try {
            await navigator.clipboard.writeText(booking.paymentAuthorizationUrl);
            toast.success('Payment link copied');
        } catch {
            toast.error('Could not copy — select the URL manually');
        }
    };

    const resendPaymentLink = async (booking: Booking, e: React.MouseEvent) => {
        e.stopPropagation();
        setResendingId(booking.id);
        try {
            const res = await api.post(`/payments/bookings/${booking.id}/initialize`);
            await navigator.clipboard.writeText(res.data.authorizationUrl).catch(() => undefined);
            toast.success('New payment link copied');
            await queryClient.invalidateQueries({ queryKey: ['bookings'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? 'Could not generate a new link');
        } finally {
            setResendingId(null);
        }
    };

    const { data: bookingsResponse, isLoading } = useQuery({
        queryKey: ['bookings', selectedStatus, search],
        queryFn: async () => {
            const params: any = { limit: 100 }; // Fetch more for now
            if (selectedStatus !== 'ALL') params.status = selectedStatus;

            const res = await api.get('/bookings', { params });
            return res.data;
        },
    });

    const bookings: Booking[] = bookingsResponse?.data || [];

    // Client-side search filtering (API supports some filtering but search isn't fully implemented in API yet)
    const filteredBookings = bookings.filter(b =>
        b.customerName.toLowerCase().includes(search.toLowerCase()) ||
        b.bookingReference.toLowerCase().includes(search.toLowerCase()) ||
        b.service.name.toLowerCase().includes(search.toLowerCase())
    );

    const handleViewBooking = (booking: Booking) => {
        setSelectedBooking(booking);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedBooking(null);
    };

    const stats = {
        total: bookings.length,
        confirmed: bookings.filter(b => b.status === 'CONFIRMED').length,
        completed: bookings.filter(b => b.status === 'COMPLETED').length,
        cancelled: bookings.filter(b => b.status === 'CANCELLED').length,
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'PENDING_PAYMENT':
                return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Pending Payment</span>;
            case 'CONFIRMED':
                return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Confirmed</span>;
            case 'COMPLETED':
                return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Completed</span>;
            case 'CANCELLED':
                return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Cancelled</span>;
            case 'NO_SHOW':
                return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">No Show</span>;
            default:
                return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400">{status}</span>;
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                        Bookings
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Manage appointments and schedules
                    </p>
                </div>
                {/* 
                <Button className="shadow-lg shadow-emerald-500/20">
                    <Plus className="w-4 h-4 mr-2" />
                    New Booking
                </Button> 
                */}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard
                    name="All Bookings"
                    value={stats.total}
                    icon={<Calendar className="w-6 h-6 text-slate-500" />}
                    color="bg-slate-500/10"
                    index={0}
                />
                <StatCard
                    name="Confirmed"
                    value={stats.confirmed}
                    icon={<CheckCircle className="w-6 h-6 text-emerald-500" />}
                    color="bg-emerald-500/10"
                    index={1}
                />
                <StatCard
                    name="Completed"
                    value={stats.completed}
                    icon={<CheckCircle className="w-6 h-6 text-blue-500" />}
                    color="bg-blue-500/10"
                    index={2}
                />
                <StatCard
                    name="Cancelled"
                    value={stats.cancelled}
                    icon={<XCircle className="w-6 h-6 text-red-500" />}
                    color="bg-red-500/10"
                    index={3}
                />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white dark:bg-slate-800/50 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm backdrop-blur-xl">
                <div className="flex p-1 bg-slate-100 dark:bg-slate-700/50 rounded-xl">
                    {['ALL', 'PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map((status) => (
                        <button
                            key={status}
                            onClick={() => setSelectedStatus(status)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedStatus === status
                                    ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                        >
                            {status.charAt(0) + status.slice(1).toLowerCase()}
                        </button>
                    ))}
                </div>

                <div className="relative w-full sm:max-w-xs group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                    <DashboardInput
                        placeholder="Search bookings..."
                        className="pl-10 h-10 bg-transparent border-slate-200 dark:border-slate-700/50"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/50 dark:bg-slate-700/20 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-4">Reference</th>
                                <th className="px-6 py-4">Customer</th>
                                <th className="px-6 py-4">Service</th>
                                <th className="px-6 py-4">Date & Time</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Payment</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                            <p>Loading bookings...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredBookings.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-2">
                                            <Calendar className="w-8 h-8 text-slate-300" />
                                            <p>No bookings found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredBookings.map((booking: Booking) => (
                                    <tr key={booking.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer" onClick={() => handleViewBooking(booking)}>
                                        <td className="px-6 py-4 font-mono text-slate-500">
                                            {booking.bookingReference}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-slate-900 dark:text-white">{booking.customerName}</div>
                                            <div className="text-xs text-slate-500">{booking.customerPhone}</div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                            {booking.service.name}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col text-slate-600 dark:text-slate-300">
                                                <span className="font-medium">{format(new Date(booking.startTime), 'MMM d, yyyy')}</span>
                                                <span className="text-xs text-slate-500">
                                                    {format(new Date(booking.startTime), 'h:mm a')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {getStatusBadge(booking.status)}
                                        </td>
                                        <td className="px-6 py-4">
                                            {booking.depositAmount ? (
                                                <>
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium ${paymentBadgeClass(booking.paymentStatus)}`}>
                                                        {booking.paymentStatus}
                                                    </span>
                                                    {booking.paymentStatus === 'UNPAID' && booking.status === 'PENDING_PAYMENT' && (
                                                        <div className="flex items-center gap-1 mt-1.5">
                                                            {booking.paymentAuthorizationUrl && (
                                                                <button
                                                                    onClick={(e) => copyPaymentLink(booking, e)}
                                                                    className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
                                                                    aria-label="Copy payment link"
                                                                >
                                                                    <Link2 className="w-3 h-3" /> Copy link
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={(e) => resendPaymentLink(booking, e)}
                                                                disabled={resendingId === booking.id}
                                                                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline disabled:opacity-50"
                                                                aria-label="Generate new payment link"
                                                            >
                                                                <RefreshCw className={`w-3 h-3 ${resendingId === booking.id ? 'animate-spin' : ''}`} />
                                                                {resendingId === booking.id ? 'Generating…' : 'New link'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-xs text-slate-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewBooking(booking); }}>
                                                View
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <BookingDetailsModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                booking={selectedBooking}
            />
        </div>
    );
}
