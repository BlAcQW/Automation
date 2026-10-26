'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Building2, Phone, Instagram, Facebook } from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, SkeletonTableRow, StatusPill } from '@bookingflow/ui';
import { NewOrganisation } from './new-organisation';
import { Pager, Table, THead, Td, Th, Tr } from '../_components/parts';
import { formatDate } from '../_components/format';

export default function AdminTenantsPage() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [whatsappFilter, setWhatsappFilter] = useState<'' | 'not_connected' | 'problem'>('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'tenants', page, search, whatsappFilter],
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (search) params.set('search', search);
            if (whatsappFilter) params.set('whatsapp', whatsappFilter);
            const res = await adminApi.get(`/admin/tenants?${params}`);
            return res.data;
        },
    });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <PageHeader title="Businesses" subtitle="Every business on Bookly, with their plan and channels." />
                <NewOrganisation />
            </div>

            <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search businesses"
                    placeholder="Search businesses…"
                    className="w-full sm:max-w-md sm:flex-1"
                />
                <Button type="submit">Search</Button>
                <div className="sm:w-64">
                    <Select
                        aria-label="Filter by WhatsApp"
                        value={whatsappFilter}
                        onChange={(e) => { setWhatsappFilter(e.target.value as typeof whatsappFilter); setPage(1); }}
                    >
                        <option value="">All businesses</option>
                        <option value="not_connected">WhatsApp not connected</option>
                        <option value="problem">WhatsApp has a problem</option>
                    </Select>
                </div>
            </form>

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading businesses…</span>
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)}
                    </div>
                ) : data?.data?.length === 0 ? (
                    <EmptyState
                        icon={<Building2 className="h-6 w-6" aria-hidden />}
                        title="No businesses found"
                        description={search || whatsappFilter ? 'Try a different search or filter.' : 'New sign-ups will show up here.'}
                    />
                ) : (
                    <>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Business</Th>
                                    <Th>Plan</Th>
                                    <Th>Messages (month)</Th>
                                    <Th className="md:hidden 2xl:table-cell">Timezone</Th>
                                    <Th>Users</Th>
                                    <Th className="md:hidden 2xl:table-cell">Services</Th>
                                    <Th>Bookings</Th>
                                    <Th>Channels</Th>
                                    <Th>Status</Th>
                                    <Th>Joined</Th>
                                </tr>
                            </THead>
                            <tbody>
                                {data?.data?.map((tenant: any) => (
                                    <Tr key={tenant.id}>
                                        <Td className="md:min-w-[11rem]">
                                            <Link href={`/admin/tenants/${tenant.id}`} className="font-semibold text-text hover:text-primary">
                                                {tenant.name}
                                            </Link>
                                            {tenant.whatsappDisplayNumber && (
                                                <p className="text-[14px] text-muted">{tenant.whatsappDisplayNumber}</p>
                                            )}
                                        </Td>
                                        <Td label="Plan">
                                            <Badge variant={tenant.planId === 'pro' ? 'success' : tenant.planId === 'starter' ? 'info' : 'neutral'}>
                                                {(tenant.planId ?? 'free').toUpperCase()}
                                            </Badge>
                                        </Td>
                                        <Td label="Messages" className="font-mono tabular-nums">{(tenant.messagesThisMonth ?? 0).toLocaleString()}</Td>
                                        <Td label="Timezone" className="text-muted md:hidden 2xl:table-cell">{tenant.timezone}</Td>
                                        <Td label="Users" className="tabular-nums">{tenant.usersCount}</Td>
                                        <Td label="Services" className="tabular-nums md:hidden 2xl:table-cell">{tenant.servicesCount}</Td>
                                        <Td label="Bookings" className="tabular-nums">{tenant.bookingsCount}</Td>
                                        <Td label="Channels"><ChannelIcons channels={tenant.channels} /></Td>
                                        <Td label="Status">
                                            <StatusPill size="sm" status={tenant.isActive ? 'active' : 'inactive'} tone={tenant.isActive ? 'success' : 'error'} />
                                        </Td>
                                        <Td label="Joined" className="whitespace-nowrap text-muted">{formatDate(tenant.createdAt)}</Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>

                        {data?.pagination && (
                            <Pager
                                page={page}
                                totalPages={data.pagination.totalPages}
                                onPage={setPage}
                                summary={`Showing ${((page - 1) * 20) + 1}–${Math.min(page * 20, data.pagination.total)} of ${data.pagination.total} businesses`}
                            />
                        )}
                    </>
                )}
            </Card>
        </div>
    );
}

const WA_TONE: Record<string, { cls: string; label: string }> = {
    connected: { cls: 'text-success-fg', label: 'WhatsApp connected' },
    problem: { cls: 'text-error-fg', label: 'WhatsApp has a problem' },
    pending: { cls: 'text-warning-fg', label: 'WhatsApp waiting for its code' },
    none: { cls: 'text-muted/50', label: 'WhatsApp not connected' },
};

/** Three small marks: WhatsApp (connected / problem / pending / none), Instagram, Messenger. */
function ChannelIcons({ channels }: { channels?: { whatsapp: string; whatsappMode: string | null; instagram: boolean; messenger: boolean } }) {
    if (!channels) return null;
    const wa = WA_TONE[channels.whatsapp] ?? WA_TONE.none;
    const waLabel = `${wa.label}${channels.whatsappMode === 'BOOKLY_HOSTED' ? ' (Bookly-hosted)' : channels.whatsappMode ? ' (own account)' : ''}`;
    return (
        <span className="flex items-center gap-2">
            <span title={waLabel} aria-label={waLabel}><Phone className={`h-4 w-4 ${wa.cls}`} /></span>
            <span title={channels.instagram ? 'Instagram connected' : 'Instagram not connected'} aria-label={channels.instagram ? 'Instagram connected' : 'Instagram not connected'}>
                <Instagram className={`h-4 w-4 ${channels.instagram ? 'text-success-fg' : 'text-muted/50'}`} />
            </span>
            <span title={channels.messenger ? 'Messenger connected' : 'Messenger not connected'} aria-label={channels.messenger ? 'Messenger connected' : 'Messenger not connected'}>
                <Facebook className={`h-4 w-4 ${channels.messenger ? 'text-success-fg' : 'text-muted/50'}`} />
            </span>
        </span>
    );
}
