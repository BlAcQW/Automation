'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronRight, Download, Hourglass, ListChecks, Send, ShieldOff, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import {
    Button, Card, EmptyState, ErrorState, FilterChips, PageHeader, SearchInput, Select, Skeleton, SkeletonTableRow, StatCard,
    StatusPill, formatGhanaPhone,
} from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { BUSINESS_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, WAITLIST_BUSINESS_TYPES, WAITLIST_STATUSES } from '@/lib/waitlist';
import { useAdmin } from '../admin-context';
import { Pager, Table, THead, Td, Th, Tr } from '../_components/parts';
import { errorMessage, formatDate, timeAgo } from '../_components/format';
import { WaitlistDrawer } from './waitlist-drawer';
import type { WaitlistEntry, WaitlistPage, WaitlistSummary } from './types';

const LIMIT = 20;

function useDebounced<T>(value: T, ms: number): T {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
}

/** The download needs the admin token, so fetch it as a blob rather than linking to it. */
async function downloadCsv(params: URLSearchParams) {
    const res = await adminApi.get(`/admin/waitlist/export.csv?${params}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookly-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export default function AdminWaitlistPage() {
    const { can } = useAdmin();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [businessType, setBusinessType] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const debouncedSearch = useDebounced(search.trim(), 300);
    const allowed = can('waitlist:read');

    useEffect(() => { setPage(1); }, [debouncedSearch, status, businessType]);

    const filters = useMemo(() => {
        const p = new URLSearchParams();
        if (debouncedSearch) p.set('search', debouncedSearch);
        if (status) p.set('status', status);
        if (businessType) p.set('businessType', businessType);
        return p;
    }, [debouncedSearch, status, businessType]);

    const summary = useQuery({
        queryKey: ['admin', 'waitlist', 'summary'],
        queryFn: async () => (await adminApi.get('/admin/waitlist/summary')).data.data as WaitlistSummary,
        enabled: allowed,
    });

    const list = useQuery({
        queryKey: ['admin', 'waitlist', 'list', filters.toString(), page],
        queryFn: async () => {
            const p = new URLSearchParams(filters);
            p.set('page', String(page));
            p.set('limit', String(LIMIT));
            return (await adminApi.get(`/admin/waitlist?${p}`)).data as WaitlistPage;
        },
        enabled: allowed,
        placeholderData: (prev) => prev,
    });

    const rows = list.data?.data ?? [];
    const open = rows.find((r) => r.id === openId) ?? null;
    const filtered = Boolean(debouncedSearch || status || businessType);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'waitlist'] });
    const onChanged = (updated: WaitlistEntry) => {
        queryClient.setQueryData<WaitlistPage>(['admin', 'waitlist', 'list', filters.toString(), page], (prev) =>
            prev ? { ...prev, data: prev.data.map((r) => (r.id === updated.id ? updated : r)) } : prev);
        queryClient.invalidateQueries({ queryKey: ['admin', 'waitlist', 'summary'] });
    };
    const onDeleted = () => { setOpenId(null); refresh(); };

    const exportCsv = async () => {
        setExporting(true);
        try {
            await downloadCsv(filters);
            toast.success('Waitlist downloaded');
        } catch (err) {
            toast.error(errorMessage(err, "Couldn't download the list. Let's try again."));
        } finally {
            setExporting(false);
        }
    };

    if (!allowed) {
        return (
            <div className="space-y-6">
                <PageHeader title="Waitlist" />
                <Card>
                    <EmptyState
                        icon={<ShieldOff className="h-6 w-6" aria-hidden />}
                        title="Access needed"
                        description="Your admin role can't see the waitlist. Ask an owner if you need it."
                    />
                </Card>
            </div>
        );
    }

    const s = summary.data;
    const statusChips = WAITLIST_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v], count: s?.byStatus?.[v] }));

    return (
        <div className="space-y-6">
            <PageHeader
                title="Waitlist"
                subtitle="Businesses waiting to join while sign-up is closed. Invite them one at a time."
                actions={can('waitlist:export') ? (
                    <Button variant="secondary" onClick={exportCsv} isLoading={exporting} loadingText="Preparing…">
                        <Download className="h-4 w-4" aria-hidden /> Export CSV
                    </Button>
                ) : undefined}
            />

            <section aria-label="Waitlist in numbers" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {summary.isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[124px] rounded-card" />)
                ) : (
                    <>
                        <StatCard name="On the list" value={s?.total ?? 0} icon={<Users />} index={0} />
                        <StatCard name="This week" value={s?.newThisWeek ?? 0} icon={<CalendarPlus />} index={1} />
                        <StatCard name="Waiting" value={s?.byStatus?.NEW ?? 0} icon={<Hourglass />} index={2} />
                        <StatCard name="Invited" value={s?.byStatus?.INVITED ?? 0} icon={<Send />} index={3} />
                    </>
                )}
            </section>

            <div className="space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <SearchInput
                        value={search}
                        onChange={setSearch}
                        label="Search the waitlist"
                        placeholder="Search the waitlist…"
                        className="w-full md:max-w-md md:flex-1"
                    />
                    <div className="md:w-72">
                        <Select
                            id="wl-type-filter"
                            aria-label="Business type"
                            value={businessType}
                            onChange={(e) => setBusinessType(e.target.value)}
                        >
                            <option value="">All business types</option>
                            {WAITLIST_BUSINESS_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                    {t.label}{s?.byBusinessType?.[t.value] ? ` (${s.byBusinessType[t.value]})` : ''}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>
                <FilterChips
                    label="Filter by status"
                    chips={statusChips}
                    selected={status ? [status] : []}
                    onToggle={(v) => setStatus((cur) => (cur === v ? '' : v))}
                />
            </div>

            <Card className="overflow-hidden">
                {list.isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading the waitlist…</span>
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)}
                    </div>
                ) : list.error ? (
                    <ErrorState title="We couldn't load the waitlist" onRetry={() => list.refetch()} isRetrying={list.isRefetching} />
                ) : rows.length === 0 ? (
                    filtered ? (
                        <EmptyState
                            icon={<ListChecks className="h-6 w-6" aria-hidden />}
                            title="Nobody matches"
                            description="Try a different name or number, or clear the filters."
                            action={<Button variant="secondary" onClick={() => { setSearch(''); setStatus(''); setBusinessType(''); }}>Clear filters</Button>}
                        />
                    ) : (
                        <EmptyState
                            icon={<ListChecks className="h-6 w-6" aria-hidden />}
                            title="Nobody on the waitlist yet"
                            description="When businesses join from the website, they show up here."
                        />
                    )
                ) : (
                    <>
                        <Table>
                            <THead>
                                <tr>
                                    <Th>Business</Th>
                                    <Th>Contact</Th>
                                    <Th>Town or area</Th>
                                    <Th>Status</Th>
                                    <Th>Joined</Th>
                                    <Th><span className="sr-only">Details</span></Th>
                                </tr>
                            </THead>
                            <tbody>
                                {rows.map((r) => (
                                    <Tr key={r.id}>
                                        <Td>
                                            <button
                                                type="button"
                                                onClick={() => setOpenId(r.id)}
                                                className="min-h-[44px] w-full rounded-control text-left md:min-h-0"
                                            >
                                                <span className="block font-semibold text-text">{r.businessName}</span>
                                                <span className="block text-[14px] text-muted">{BUSINESS_TYPE_LABEL[r.businessType] ?? r.businessType}</span>
                                            </button>
                                        </Td>
                                        <Td label="Contact">
                                            <span className="block">{r.name}</span>
                                            <span className="block whitespace-nowrap text-[14px] text-muted tabular-nums">{formatGhanaPhone(r.phone)}</span>
                                            <span className="block break-all text-[14px] text-muted">{r.email}</span>
                                        </Td>
                                        <Td label="Town or area">{r.city}</Td>
                                        <Td label="Status">
                                            <StatusPill size="sm" status={r.status} tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} />
                                        </Td>
                                        <Td label="Joined" className="whitespace-nowrap text-muted">
                                            <span title={formatDate(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                                        </Td>
                                        <Td>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setOpenId(r.id)}
                                                className="w-full justify-center md:w-auto"
                                            >
                                                <span className="md:sr-only">View details</span>
                                                <span className="sr-only"> for {r.businessName}</span>
                                                <ChevronRight className="h-4 w-4" aria-hidden />
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                        {list.data?.pagination && (
                            <Pager
                                page={page}
                                totalPages={list.data.pagination.totalPages}
                                onPage={setPage}
                                summary={`Showing ${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, list.data.pagination.total)} of ${list.data.pagination.total}`}
                            />
                        )}
                    </>
                )}
            </Card>

            <WaitlistDrawer
                entry={open}
                canWrite={can('waitlist:write')}
                onClose={() => setOpenId(null)}
                onChanged={onChanged}
                onDeleted={onDeleted}
            />
        </div>
    );
}
