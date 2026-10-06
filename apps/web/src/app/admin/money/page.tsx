'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Button } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { Empty, Panel, Table, Td, Th } from '../_components/parts';
import { formatDateTime, formatMinor } from '../_components/format';

const STATUSES = ['', 'REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const;
const STATUS_VARIANT: Record<string, 'default' | 'yellow' | 'red' | 'slate'> = { PAID: 'default', FAILED: 'red', PROCESSING: 'yellow', REQUESTED: 'yellow', CANCELLED: 'slate' };

export default function AdminMoneyPage() {
    const [status, setStatus] = useState<(typeof STATUSES)[number]>('');
    const [page, setPage] = useState(1);
    const [refundState, setRefundState] = useState<'pending' | 'refunding' | 'refunded'>('pending');

    const overview = useQuery({
        queryKey: ['admin', 'money', 'overview'],
        queryFn: async () => (await adminApi.get('/admin/money/overview')).data,
    });
    const payouts = useQuery({
        queryKey: ['admin', 'money', 'payouts', status, page],
        queryFn: async () => {
            const p = new URLSearchParams({ page: String(page), limit: '20' });
            if (status) p.set('status', status);
            return (await adminApi.get(`/admin/money/payouts?${p}`)).data;
        },
    });
    const refunds = useQuery({
        queryKey: ['admin', 'money', 'refunds', refundState],
        queryFn: async () => (await adminApi.get(`/admin/money/refunds?state=${refundState}&limit=20`)).data,
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Money</h1>
                <p className="text-slate-400">Read-only oversight of balances, payouts, refunds and fees. Nothing here moves money.</p>
            </div>

            {overview.isLoading ? <div className="flex h-32 items-center justify-center"><BooklyDots size="md" /></div> : overview.data && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <Panel title="Tenant balances by currency">
                        {!overview.data.balances.length ? <Empty>No wallets yet.</Empty> : (
                            <Table>
                                <thead><tr><Th>Currency</Th><Th>Available</Th><Th>Pending</Th><Th>Wallets</Th></tr></thead>
                                <tbody>
                                    {overview.data.balances.map((b: any) => (
                                        <tr key={b.currency} className="border-t border-white/5">
                                            <Td className="text-white">{b.currency}</Td>
                                            <Td className="tabular-nums">{formatMinor(b.availableMinor, b.currency)}</Td>
                                            <Td className="tabular-nums">{formatMinor(b.pendingMinor, b.currency)}</Td>
                                            <Td className="tabular-nums">{b.wallets}</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                        <p className="px-6 py-3 text-xs text-slate-500">{overview.data.note}</p>
                    </Panel>

                    <Panel title="Payouts by status">
                        {!overview.data.payouts.length ? <Empty>No payouts yet.</Empty> : (
                            <Table>
                                <thead><tr><Th>Status</Th><Th>Count</Th><Th>Total</Th></tr></thead>
                                <tbody>
                                    {overview.data.payouts.map((p: any) => (
                                        <tr key={`${p.status}-${p.currency}`} className="border-t border-white/5">
                                            <Td><Badge variant={STATUS_VARIANT[p.status] ?? 'slate'}>{p.status}</Badge></Td>
                                            <Td className="tabular-nums">{p.count}</Td>
                                            <Td className="tabular-nums">{formatMinor(p.totalMinor, p.currency)}</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>

                    <Panel title="Refunds">
                        <div className="grid grid-cols-3 gap-4 px-6 py-5 text-center">
                            <div><p className="text-2xl font-semibold tabular-nums text-amber-300">{overview.data.refunds.pending}</p><p className="text-xs text-slate-500">Waiting to retry</p></div>
                            <div><p className="text-2xl font-semibold tabular-nums text-white">{overview.data.refunds.refunding}</p><p className="text-xs text-slate-500">In flight</p></div>
                            <div><p className="text-2xl font-semibold tabular-nums text-emerald-300">{overview.data.refunds.refunded}</p><p className="text-xs text-slate-500">Refunded</p></div>
                        </div>
                    </Panel>

                    <Panel title={`Platform fees (last ${overview.data.fees.windowDays} days)`}>
                        {!overview.data.fees.byCurrency.length ? <Empty>No fees taken in this window.</Empty> : (
                            <ul className="divide-y divide-white/5">
                                {overview.data.fees.byCurrency.map((f: any) => (
                                    <li key={f.currency} className="flex justify-between px-6 py-3 text-sm"><span className="text-slate-300">{f.currency}</span><span className="tabular-nums text-white">{formatMinor(f.totalMinor, f.currency)}</span></li>
                                ))}
                            </ul>
                        )}
                    </Panel>
                </div>
            )}

            <Panel
                title="Payouts"
                action={
                    <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}
                        className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-white">
                        {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
                    </select>
                }
            >
                {payouts.isLoading ? <div className="flex h-24 items-center justify-center"><BooklyDots size="md" /></div> : !payouts.data?.data.length ? <Empty>No payouts match.</Empty> : (
                    <>
                        <Table>
                            <thead><tr><Th>When</Th><Th>Organisation</Th><Th>Amount</Th><Th>To</Th><Th>Status</Th><Th>Note</Th></tr></thead>
                            <tbody>
                                {payouts.data.data.map((p: any) => (
                                    <tr key={p.id} className="border-t border-white/5">
                                        <Td className="whitespace-nowrap">{formatDateTime(p.createdAt)}</Td>
                                        <Td><Link href={`/admin/tenants/${p.tenantId}`} className="text-white hover:text-emerald-400">{p.tenantName ?? p.tenantId}</Link></Td>
                                        <Td className="tabular-nums">{formatMinor(p.amountMinor, p.currency)}</Td>
                                        <Td>{p.recipient.accountName}<p className="text-xs text-slate-500">{p.recipient.accountNumberMasked}</p></Td>
                                        <Td><Badge variant={STATUS_VARIANT[p.status] ?? 'slate'}>{p.status}</Badge></Td>
                                        <Td>{p.failureReason ?? '—'}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                        <Pager page={page} totalPages={payouts.data.pagination.totalPages} total={payouts.data.pagination.total} onPage={setPage} />
                    </>
                )}
            </Panel>

            <Panel
                title="Refunds"
                action={
                    <select aria-label="Refund state" value={refundState} onChange={(e) => setRefundState(e.target.value as typeof refundState)}
                        className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-white">
                        <option value="pending">Waiting to retry</option><option value="refunding">In flight</option><option value="refunded">Refunded</option>
                    </select>
                }
            >
                {refunds.isLoading ? <div className="flex h-24 items-center justify-center"><BooklyDots size="md" /></div> : !refunds.data?.data.length ? <Empty>No refunds in this state.</Empty> : (
                    <Table>
                        <thead><tr><Th>Booking</Th><Th>Organisation</Th><Th>Amount</Th><Th>Attempts</Th><Th>Last error</Th><Th>Next try</Th></tr></thead>
                        <tbody>
                            {refunds.data.data.map((r: any) => (
                                <tr key={r.bookingId} className="border-t border-white/5">
                                    <Td className="font-mono text-xs">{r.reference}</Td>
                                    <Td><Link href={`/admin/tenants/${r.tenantId}`} className="text-white hover:text-emerald-400">{r.tenantName ?? r.tenantId}</Link></Td>
                                    <Td className="tabular-nums">{r.amount ?? '—'}</Td>
                                    <Td className="tabular-nums">{r.attempts}</Td>
                                    <Td>{r.lastError ?? '—'}</Td>
                                    <Td className="whitespace-nowrap">{formatDateTime(r.nextAttemptAt)}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>
        </div>
    );
}

function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
    if (totalPages <= 1) return <p className="px-6 py-3 text-xs text-slate-500">{total} payouts</p>;
    return (
        <div className="flex items-center justify-between border-t border-white/5 px-6 py-3">
            <p className="text-sm text-slate-400">{total} payouts</p>
            <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                <span className="px-2 text-sm text-white">Page {page} of {totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
            </div>
        </div>
    );
}
