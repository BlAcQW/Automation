'use client';

import { useState } from 'react';
import { CalendarPlus, Calendar, Wallet, Users, MessageCircle } from 'lucide-react';
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    EmptyState,
    ErrorState,
    ResponsiveTable,
    SkeletonCard,
    SkeletonLine,
    SkeletonList,
    SkeletonTableRow,
    StatCard,
    StatusPill,
    Tabs,
    formatCedi,
    formatGhanaPhone,
} from '@bookingflow/ui';
import { Row, Section } from './section';

interface Booking {
    id: string;
    customer: string;
    phone: string;
    service: string;
    when: string;
    amount: number;
    status: string;
}

const BOOKINGS: Booking[] = [
    { id: '1', customer: 'Ama Mensah', phone: '0244123456', service: 'Braids', when: 'Today, 10:00', amount: 250, status: 'confirmed' },
    { id: '2', customer: 'Kofi Boateng', phone: '0201234567', service: 'Haircut', when: 'Today, 13:30', amount: 60, status: 'pending' },
    { id: '3', customer: 'Efua Owusu', phone: '0559876543', service: 'Nails', when: 'Tomorrow, 09:00', amount: 120, status: 'paid' },
    { id: '4', customer: 'Yaw Asante', phone: '0277654321', service: 'Shave', when: 'Fri, 16:00', amount: 40, status: 'failed' },
];

export function DataSection() {
    const [tab, setTab] = useState('upcoming');
    return (
        <>
            <Section title="Cards & stats">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard name="Bookings today" value={6} icon={<Calendar />} change={{ value: 12.5, direction: 'up', label: 'vs last week' }} />
                    <StatCard name="Paid this week" value={formatCedi(2450, { compact: true })} icon={<Wallet />} />
                    <StatCard name="New customers" value={14} icon={<Users />} change={{ value: 3.2, direction: 'down' }} />
                    <StatCard name="Open chats" value={3} icon={<MessageCircle />} index={3} />
                </div>
                <Card hover>
                    <CardHeader><CardTitle>Today&apos;s appointments</CardTitle></CardHeader>
                    <CardContent className="text-[15px] text-muted">Cards are white on cream, 20px corners, a hairline border and a soft warm shadow.</CardContent>
                </Card>
            </Section>

            <Section title="Status" description="Always icon + word + colour. Never colour alone.">
                <Row label="StatusPill">
                    <StatusPill status="confirmed" />
                    <StatusPill status="PAID" />
                    <StatusPill status="pending" />
                    <StatusPill status="failed" />
                    <StatusPill status="cancelled" />
                    <StatusPill status="draft" />
                    <StatusPill status="awaiting_payment" size="sm" />
                </Row>
                <Row label="Badge (labels, not statuses)">
                    <Badge variant="neutral">Walk-in</Badge>
                    <Badge variant="success">New</Badge>
                    <Badge variant="warning">Low stock</Badge>
                    <Badge variant="error">Overdue</Badge>
                    <Badge variant="info">Mobile money</Badge>
                    <Badge dot pulse variant="success">Live</Badge>
                </Row>
            </Section>

            <Section title="Tabs & responsive table" description="A table on desktop; cards on phones. No sideways scrolling.">
                <Tabs
                    label="Bookings"
                    value={tab}
                    onChange={setTab}
                    items={[
                        { value: 'upcoming', label: 'Upcoming', count: 4 },
                        { value: 'past', label: 'Past' },
                        { value: 'cancelled', label: 'Cancelled', count: 1 },
                    ]}
                />
                <ResponsiveTable<Booking>
                    caption="Upcoming bookings"
                    rows={BOOKINGS}
                    rowKey={(b) => b.id}
                    onRowClick={() => undefined}
                    columns={[
                        { key: 'customer', header: 'Customer', render: (b) => <span className="font-semibold">{b.customer}</span> },
                        { key: 'phone', header: 'Phone', render: (b) => formatGhanaPhone(b.phone), hideOnMobile: true },
                        { key: 'service', header: 'Service', render: (b) => b.service },
                        { key: 'when', header: 'When', render: (b) => b.when },
                        { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCedi(b.amount) },
                        { key: 'status', header: 'Status', render: (b) => <StatusPill status={b.status} size="sm" /> },
                    ]}
                />
            </Section>
        </>
    );
}

export function FeedbackSection() {
    return (
        <Section title="Loading, empty and error states" description="Skeletons, not spinners. Every empty state has one clear next step.">
            <div className="grid gap-4 lg:grid-cols-3">
                <SkeletonCard />
                <div className="rounded-card border border-border bg-surface p-5 shadow-card">
                    <SkeletonLine width="w-1/3" />
                    <SkeletonList rows={3} className="mt-3" />
                </div>
                <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
                    <SkeletonTableRow columns={3} />
                    <SkeletonTableRow columns={3} />
                    <SkeletonTableRow columns={3} />
                </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <EmptyState
                        icon={<CalendarPlus />}
                        title="No bookings yet"
                        description="Share your WhatsApp link to get your first one!"
                        action={<Button variant="accent">Share your link</Button>}
                    />
                </Card>
                <Card>
                    <ErrorState onRetry={() => undefined} />
                </Card>
            </div>
        </Section>
    );
}
