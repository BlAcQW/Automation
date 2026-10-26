'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Receipt, ArrowRight } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Card, EmptyState, PageHeader, SearchInput, SkeletonTableRow, buttonVariants } from '@bookingflow/ui';
import { formatMinor } from '../_components/format';
import { Table, THead, Td, Th, Tr } from '../_components/parts';

interface TenantRow {
    id: string;
    name: string;
    vertical: string;
    planId: string;
    isActive: boolean;
    terms: {
        currency: string;
        setupFeeMinor: number;
        monthlyFeeMinor: number;
        unitPriceMinor: number;
        unitEventType: string | null;
    } | null;
}

export default function AdminBillingPage() {
    const [search, setSearch] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'billing', 'tenants', search],
        queryFn: async () => {
            const params = new URLSearchParams({ limit: '100' });
            if (search.trim()) params.set('search', search.trim());
            return (await adminApi.get(`/admin/billing/tenants?${params}`)).data as { data: TenantRow[] };
        },
    });

    return (
        <div className="space-y-6">
            <PageHeader
                title="Billing"
                subtitle="Custom terms and usage statements for each business. Open one to set its fees or see a month's statement."
            />

            <SearchInput
                value={search}
                onChange={setSearch}
                label="Search businesses"
                placeholder="Search businesses…"
                className="w-full sm:max-w-sm"
            />

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading businesses…</span>
                        {Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} columns={4} />)}
                    </div>
                ) : !data?.data.length ? (
                    <EmptyState
                        icon={<Receipt className="h-6 w-6" aria-hidden />}
                        title="No businesses found"
                        description={search ? 'Try a different name.' : 'Businesses show up here once they sign up.'}
                    />
                ) : (
                    <Table>
                        <THead>
                            <tr>
                                <Th>Business</Th>
                                <Th>Plan</Th>
                                <Th>Custom terms</Th>
                                <Th className="w-1" />
                            </tr>
                        </THead>
                        <tbody>
                            {data.data.map((t) => (
                                <Tr key={t.id}>
                                    <Td>
                                        <div className="font-semibold text-text">{t.name}</div>
                                        <div className="text-[13px] text-muted">{t.vertical === 'RIDES' ? 'Rides' : 'Appointments'}{t.isActive ? '' : ' · inactive'}</div>
                                    </Td>
                                    <Td label="Plan" className="capitalize">{t.planId}</Td>
                                    <Td label="Custom terms">
                                        {t.terms ? (
                                            <span className="tabular-nums">
                                                {formatMinor(t.terms.monthlyFeeMinor, t.terms.currency)}/mo
                                                {t.terms.unitEventType ? ` + ${formatMinor(t.terms.unitPriceMinor, t.terms.currency)} per ${t.terms.unitEventType}` : ''}
                                            </span>
                                        ) : (
                                            <Badge variant="neutral">Not set</Badge>
                                        )}
                                    </Td>
                                    <Td>
                                        <Link
                                            href={`/admin/billing/${t.id}`}
                                            className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'w-full md:w-auto' })}
                                        >
                                            Open <ArrowRight className="h-4 w-4" aria-hidden />
                                        </Link>
                                    </Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </div>
    );
}
