'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Badge, Button, ErrorState, Input, PageHeader, Select } from '@bookingflow/ui';
import { Empty, LoadingBlock, Panel, THead, Table, Td, Th, Tr } from '../_components/parts';
import { formatDateTime } from '../_components/format';

interface Filters { tenantId: string; actorId: string; actorType: string; actionPrefix: string; from: string; to: string }
const EMPTY: Filters = { tenantId: '', actorId: '', actorType: '', actionPrefix: '', from: '', to: '' };

export default function AdminAuditPage() {
    // useSearchParams needs a Suspense boundary under Next 14 static rendering.
    return <Suspense fallback={<LoadingBlock />}><AuditLog /></Suspense>;
}

function AuditLog() {
    const search = useSearchParams();
    const initial: Filters = { ...EMPTY, tenantId: search.get('tenantId') ?? '', actorId: search.get('actorId') ?? '' };
    const [draft, setDraft] = useState<Filters>(initial);
    const [applied, setApplied] = useState<Filters>(initial);

    const query = useInfiniteQuery({
        queryKey: ['admin', 'audit', applied],
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => {
            const p = new URLSearchParams({ limit: '50' });
            for (const [k, v] of Object.entries(applied)) {
                if (!v) continue;
                // <input type="datetime-local"> has no zone: treat it as the admin's local time.
                p.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
            }
            if (pageParam) p.set('cursor', pageParam);
            return (await adminApi.get(`/admin/audit?${p}`)).data as { data: any[]; nextCursor: string | null };
        },
        getNextPageParam: (last) => last.nextCursor,
    });

    const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
    const apply = (e: React.FormEvent) => { e.preventDefault(); setApplied(draft); };
    const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft({ ...draft, [k]: e.target.value });
    const errorText = (query.error as any)?.response?.data?.message;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Audit log"
                subtitle="Everything admins, staff and the system did, newest first. Shows the last 7 days unless you pick a window (90 days at most)."
            />

            <form onSubmit={apply} className="grid grid-cols-1 gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
                <Input label="Business id" value={draft.tenantId} onChange={set('tenantId')} placeholder="any" />
                <Input label="Who did it (id)" value={draft.actorId} onChange={set('actorId')} placeholder="any" />
                <Select id="actor-type" label="Who did it (type)" value={draft.actorType} onChange={set('actorType')}>
                    <option value="">Anyone</option><option value="ADMIN">Admin</option><option value="USER">Business user</option><option value="BOT">Bot</option><option value="SYSTEM">System</option>
                </Select>
                <Input label="Action starts with" value={draft.actionPrefix} onChange={set('actionPrefix')} placeholder="support. / tenant. / flow." />
                <Input type="datetime-local" label="From" value={draft.from} onChange={set('from')} />
                <Input type="datetime-local" label="To" value={draft.to} onChange={set('to')} />
                <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-3">
                    <Button type="submit">Apply filters</Button>
                    <Button type="button" variant="secondary" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}>Clear</Button>
                </div>
            </form>

            <Panel title="Events">
                {query.isLoading ? <LoadingBlock />
                    : query.isError ? (
                        <ErrorState
                            title="We couldn't load the audit log"
                            description={errorText}
                            onRetry={() => query.refetch()}
                            isRetrying={query.isRefetching}
                        />
                    )
                        : !rows.length ? <Empty>No events match these filters.</Empty> : (
                            <>
                                <Table>
                                    <THead><tr><Th>When</Th><Th>Action</Th><Th>Who</Th><Th>Business</Th><Th>Details</Th></tr></THead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <Tr key={r.id} className="md:align-top">
                                                <Td className="whitespace-nowrap font-medium">{formatDateTime(r.createdAt)}</Td>
                                                <Td label="Action" className="break-all font-mono text-[13px]">{r.action}</Td>
                                                <Td label="Who"><Badge variant={r.actorType === 'ADMIN' ? 'info' : 'neutral'}>{r.actorType}</Badge> {r.actorName ?? r.actorId ?? ''}</Td>
                                                <Td label="Business">{r.tenantId ? <Link href={`/admin/tenants/${r.tenantId}`} className="font-medium text-text hover:text-primary">{r.tenantName ?? r.tenantId}</Link> : <span className="text-muted">Platform</span>}</Td>
                                                <Td label="Details" className="md:max-w-md">{r.metadata ? <code className="block max-w-[14rem] truncate text-[13px] text-muted md:max-w-md" title={JSON.stringify(r.metadata)}>{JSON.stringify(r.metadata)}</code> : '—'}</Td>
                                            </Tr>
                                        ))}
                                    </tbody>
                                </Table>
                                {query.hasNextPage && (
                                    <div className="border-t border-border p-4 text-center">
                                        <Button variant="secondary" onClick={() => query.fetchNextPage()} isLoading={query.isFetchingNextPage}>Load older events</Button>
                                    </div>
                                )}
                            </>
                        )}
            </Panel>
        </div>
    );
}
