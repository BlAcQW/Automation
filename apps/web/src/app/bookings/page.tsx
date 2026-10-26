'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calendar, CalendarPlus, CheckCircle, Link2, RefreshCw, SearchX, XCircle, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import {
    Button,
    EmptyState,
    ErrorState,
    FilterChips,
    PageHeader,
    ResponsiveTable,
    SearchInput,
    SkeletonList,
    StatCard,
    StatusPill,
    buttonVariants,
    type Column,
} from '@bookingflow/ui';
import { notify as toast } from '@/components/brand/toast';
import { BookingDetailsModal } from '@/components/bookings/booking-details-modal';
import { BookingStatusPill } from '@/components/bookings/booking-status-pill';
import { MaskedContact } from '@/components/ui/masked-contact';

interface Booking {
    id: string;
    bookingReference: string;
    customerName: string;
    customerPhone: string;
    contactMasked?: boolean;
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

// What the owner sees on the filter chips. Never the raw enum.
const STATUS_FILTERS = [
    { value: 'ALL', label: 'All' },
    { value: 'PENDING_PAYMENT', label: 'Awaiting payment' },
    { value: 'CONFIRMED', label: 'Confirmed' },
    { value: 'COMPLETED', label: 'Done' },
    { value: 'CANCELLED', label: 'Cancelled' },
];

const LINK_BTN =
    'inline-flex min-h-[44px] items-center gap-1.5 rounded-control px-2 text-[14px] font-semibold transition-colors duration-ui disabled:opacity-50';

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
            toast.error('This booking has no payment link yet. Tap "New link" to make one.');
            return;
        }
        try {
            await navigator.clipboard.writeText(booking.paymentAuthorizationUrl);
            toast.success('Payment link copied. Paste it in WhatsApp.');
        } catch {
            toast.error("Couldn't copy the link. Open the booking and copy it by hand.");
        }
    };

    const resendPaymentLink = async (booking: Booking, e: React.MouseEvent) => {
        e.stopPropagation();
        setResendingId(booking.id);
        try {
            const res = await api.post(`/payments/bookings/${booking.id}/initialize`);
            await navigator.clipboard.writeText(res.data.authorizationUrl).catch(() => undefined);
            toast.success('New payment link made and copied');
            await queryClient.invalidateQueries({ queryKey: ['bookings'] });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? "Couldn't make a new link. Try again.");
        } finally {
            setResendingId(null);
        }
    };

    const { data: bookingsResponse, isLoading, isError, refetch, isRefetching } = useQuery({
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

    const paymentCell = (booking: Booking) => {
        if (!booking.depositAmount) return <span className="text-muted">No deposit</span>;
        const awaiting = booking.paymentStatus === 'UNPAID' && booking.status === 'PENDING_PAYMENT';
        return (
            <div className="flex flex-col items-end gap-0.5 md:items-start">
                <StatusPill
                    status={booking.paymentStatus === 'UNPAID' ? 'unpaid' : booking.paymentStatus}
                    label={booking.paymentStatus === 'PAID' ? 'Deposit paid' : booking.paymentStatus === 'REFUNDED' ? 'Refunded' : 'Deposit due'}
                    size="sm"
                />
                {awaiting && (
                    <div className="-ml-2 flex flex-wrap items-center">
                        {booking.paymentAuthorizationUrl && (
                            <button
                                type="button"
                                onClick={(e) => copyPaymentLink(booking, e)}
                                className={`${LINK_BTN} text-primary hover:bg-primary-soft`}
                                aria-label="Copy payment link"
                            >
                                <Link2 className="h-4 w-4" aria-hidden /> Copy link
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={(e) => resendPaymentLink(booking, e)}
                            disabled={resendingId === booking.id}
                            className={`${LINK_BTN} text-muted hover:bg-surface-2 hover:text-text`}
                            aria-label="Generate new payment link"
                        >
                            <RefreshCw className={`h-4 w-4 ${resendingId === booking.id ? 'animate-spin' : ''}`} aria-hidden />
                            {resendingId === booking.id ? 'Making…' : 'New link'}
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const columns: Column<Booking>[] = [
        {
            key: 'customer',
            header: 'Customer',
            render: (b) => (
                <div className="min-w-0">
                    <div className="font-semibold text-text">{b.customerName}</div>
                    <div className="text-[14px] text-muted">
                        <MaskedContact value={b.customerPhone} masked={b.contactMasked} scope="booking" recordId={b.id} />
                    </div>
                </div>
            ),
        },
        { key: 'service', header: 'Service', render: (b) => b.service.name },
        {
            key: 'when',
            header: 'When',
            render: (b) => (
                <span className="whitespace-nowrap tabular-nums">
                    <span className="font-medium">{format(new Date(b.startTime), 'EEE d MMM')}</span>
                    <span className="text-muted"> · {format(new Date(b.startTime), 'h:mm a')}</span>
                </span>
            ),
        },
        { key: 'status', header: 'Status', render: (b) => <BookingStatusPill status={b.status} /> },
        { key: 'payment', header: 'Deposit', render: paymentCell },
        {
            key: 'ref',
            header: 'Reference',
            hideOnMobile: true,
            render: (b) => <span className="text-[14px] tabular-nums text-muted">{b.bookingReference}</span>,
        },
        {
            key: 'actions',
            header: 'Details',
            align: 'right',
            render: (b) => (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewBooking(b); }}>
                    View
                </Button>
            ),
        },
    ];

    const filtersActive = search.trim() !== '' || selectedStatus !== 'ALL';

    return (
        <div className="space-y-6 lg:space-y-8">
            <PageHeader
                title="Your bookings"
                subtitle="Everyone who has booked with you, newest first. Tap a booking to see it or change it."
            />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard name="All bookings" value={stats.total} icon={<Calendar />} index={0} />
                <StatCard name="Confirmed" value={stats.confirmed} icon={<CheckCircle />} index={1} />
                <StatCard name="Done" value={stats.completed} icon={<CheckCheck />} index={2} />
                <StatCard name="Cancelled" value={stats.cancelled} icon={<XCircle />} index={3} />
            </div>

            <div className="space-y-3">
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search bookings"
                    placeholder="Search by name, service or reference"
                    className="sm:max-w-md"
                />
                <FilterChips
                    label="Filter bookings by status"
                    chips={STATUS_FILTERS}
                    selected={[selectedStatus]}
                    onToggle={setSelectedStatus}
                />
            </div>

            {isLoading ? (
                <div aria-busy="true" className="rounded-card border border-border bg-surface px-4 shadow-card">
                    <span className="sr-only">Loading your bookings…</span>
                    <SkeletonList rows={6} />
                </div>
            ) : isError ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    <ErrorState onRetry={() => refetch()} isRetrying={isRefetching} />
                </div>
            ) : filteredBookings.length === 0 ? (
                <div className="rounded-card border border-border bg-surface shadow-card">
                    {filtersActive ? (
                        <EmptyState
                            icon={<SearchX />}
                            title="No bookings match"
                            description="Try another name, or show all bookings."
                            action={
                                <Button variant="secondary" onClick={() => { setSearch(''); setSelectedStatus('ALL'); }}>
                                    Show all bookings
                                </Button>
                            }
                        />
                    ) : (
                        <EmptyState
                            icon={<CalendarPlus />}
                            title="No bookings yet"
                            description="Share your WhatsApp link to get your first one!"
                            action={<Link href="/channels" className={buttonVariants()}>Get your WhatsApp link</Link>}
                        />
                    )}
                </div>
            ) : (
                <ResponsiveTable
                    caption="Your bookings"
                    columns={columns}
                    rows={filteredBookings}
                    rowKey={(b) => b.id}
                    cardTitle={(b) => (
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="truncate">{b.customerName}</div>
                                <div className="text-[14px] font-normal text-muted">
                                    <MaskedContact value={b.customerPhone} masked={b.contactMasked} scope="booking" recordId={b.id} />
                                </div>
                            </div>
                        </div>
                    )}
                />
            )}

            <BookingDetailsModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                booking={selectedBooking}
            />
        </div>
    );
}
