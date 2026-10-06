'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Badge, Button, Input } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { Empty, Panel, Table, Td, Th } from '../_components/parts';
import { formatDateTime } from '../_components/format';

interface Filters { tenantId: string; actorId: string; actorType: string; actionPrefix: string; from: string; to: string }
const EMPTY: Filters = { tenantId: '', actorId: '', actorType: '', actionPrefix: '', from: '', to: '' };

export default function AdminAuditPage() {
    // useSearchParams needs a Suspense boundary under Next 14 static rendering.
    return <Suspense fallback={<div className="flex h-32 items-center justify-center"><BooklyDots size="md" /></div>}><AuditLog /></Suspense>;
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
            <div>
                <h1 className="text-2xl font-bold text-white">Audit log</h1>
                <p className="text-slate-400">Everything admins, staff and the system did. Newest first; shows the last 7 days unless you pick a window (90 days at most).</p>
            </div>

            <form onSubmit={apply} className="grid grid-cols-1 gap-3 rounded-2xl border border-white/5 p-4 glass-card sm:grid-cols-2 xl:grid-cols-6">
                <Input label="Organisation id" value={draft.tenantId} onChange={set('tenantId')} placeholder="any" />
                <Input label="Actor id" value={draft.actorId} onChange={set('actorId')} placeholder="any" />
                <div className="space-y-1.5">
                    <label htmlFor="actor-type" className="block text-sm font-medium text-ink-100">Actor type</label>
                    <select id="actor-type" value={draft.actorType} onChange={set('actorType')} className="w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-3 text-base text-ink-50">
                        <option value="">Any</option><option value="ADMIN">Admin</option><option value="USER">Tenant user</option><option value="BOT">Bot</option><option value="SYSTEM">System</option>
                    </select>
                </div>
                <Input label="Action starts with" value={draft.actionPrefix} onChange={set('actionPrefix')} placeholder="support. / tenant. / flow." />
                <Input type="datetime-local" label="From" value={draft.from} onChange={set('from')} />
                <Input type="datetime-local" label="To" value={draft.to} onChange={set('to')} />
                <div className="flex gap-2 sm:col-span-2 xl:col-span-6">
                    <Button type="submit">Apply filters</Button>
                    <Button type="button" variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}>Clear</Button>
                </div>
            </form>

            <Panel title="Events">
                {query.isLoading ? <div className="flex h-32 items-center justify-center"><BooklyDots size="md" /></div>
                    : query.isError ? <p className="px-6 py-8 text-center text-sm text-red-400">{errorText ?? 'Could not load the audit log.'}</p>
                        : !rows.length ? <Empty>No events match.</Empty> : (
                            <>
                                <Table>
                                    <thead><tr><Th>When</Th><Th>Action</Th><Th>Actor</Th><Th>Organisation</Th><Th>Details</Th></tr></thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr key={r.id} className="border-t border-white/5 align-top">
                                                <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                                                <Td className="font-mono text-xs text-white">{r.action}</Td>
                                                <Td><Badge variant={r.actorType === 'ADMIN' ? 'purple' : 'slate'}>{r.actorType}</Badge> {r.actorName ?? r.actorId ?? ''}</Td>
                                                <Td>{r.tenantId ? <Link href={`/admin/tenants/${r.tenantId}`} className="text-white hover:text-emerald-400">{r.tenantName ?? r.tenantId}</Link> : <span className="text-slate-500">Platform</span>}</Td>
                                                <Td className="max-w-md">{r.metadata ? <code className="block truncate text-xs text-slate-400" title={JSON.stringify(r.metadata)}>{JSON.stringify(r.metadata)}</code> : '—'}</Td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                                {query.hasNextPage && (
                                    <div className="border-t border-white/5 p-4 text-center">
                                        <Button variant="outline" onClick={() => query.fetchNextPage()} isLoading={query.isFetchingNextPage}>Load older events</Button>
                                    </div>
                                )}
                            </>
                        )}
            </Panel>
        </div>
    );
}
