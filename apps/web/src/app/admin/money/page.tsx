'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { PageHeader, Select, StatusPill, type StatusTone } from '@bookingflow/ui';
import { Empty, LoadingBlock, Pager as ListPager, Panel, THead, Table, Td, Th, Tr } from '../_components/parts';
import { formatDateTime, formatMinor } from '../_components/format';

const STATUSES = ['', 'REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const;
const STATUS_TONE: Record<string, StatusTone> = { PAID: 'success', FAILED: 'error', PROCESSING: 'warning', REQUESTED: 'warning', CANCELLED: 'neutral' };
const STATUS_LABEL: Record<string, string> = { REQUESTED: 'Requested', PROCESSING: 'Processing', PAID: 'Paid', FAILED: 'Failed', CANCELLED: 'Cancelled' };

function PayoutStatus({ status }: { status: string }) {
    return <StatusPill size="sm" status={status} tone={STATUS_TONE[status] ?? 'neutral'} label={STATUS_LABEL[status]} />;
}

const businessLink = (id: string, name: string | null) => (
    <Link href={`/admin/tenants/${id}`} className="font-medium text-text hover:text-primary">{name ?? id}</Link>
);

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
            <PageHeader title="Money" subtitle="A view-only look at balances, payouts, refunds and fees. Nothing on this page moves money." />

            {overview.isLoading ? <LoadingBlock /> : overview.data && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <Panel title="Business balances by currency">
                        {!overview.data.balances.length ? <Empty>No wallets yet.</Empty> : (
                            <Table>
                                <THead><tr><Th>Currency</Th><Th>Available</Th><Th>Pending</Th><Th>Wallets</Th></tr></THead>
                                <tbody>
                                    {overview.data.balances.map((b: any) => (
                                        <Tr key={b.currency}>
                                            <Td className="font-semibold">{b.currency}</Td>
                                            <Td label="Available" className="whitespace-nowrap tabular-nums">{formatMinor(b.availableMinor, b.currency)}</Td>
                                            <Td label="Pending" className="whitespace-nowrap tabular-nums">{formatMinor(b.pendingMinor, b.currency)}</Td>
                                            <Td label="Wallets" className="tabular-nums">{b.wallets}</Td>
                                        </Tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                        <p className="px-4 py-3 text-[14px] text-muted sm:px-6">{overview.data.note}</p>
                    </Panel>

                    <Panel title="Payouts by status">
                        {!overview.data.payouts.length ? <Empty>No payouts yet.</Empty> : (
                            <Table>
                                <THead><tr><Th>Status</Th><Th>Count</Th><Th>Total</Th></tr></THead>
                                <tbody>
                                    {overview.data.payouts.map((p: any) => (
                                        <Tr key={`${p.status}-${p.currency}`}>
                                            <Td><PayoutStatus status={p.status} /></Td>
                                            <Td label="Count" className="tabular-nums">{p.count}</Td>
                                            <Td label="Total" className="whitespace-nowrap tabular-nums">{formatMinor(p.totalMinor, p.currency)}</Td>
                                        </Tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>

                    <Panel title="Refunds">
                        <div className="grid grid-cols-3 gap-3 px-4 py-5 text-center sm:px-6">
                            <RefundFigure value={overview.data.refunds.pending} label="Waiting to retry" tone="text-warning-fg" />
                            <RefundFigure value={overview.data.refunds.refunding} label="In flight" tone="text-text" />
                            <RefundFigure value={overview.data.refunds.refunded} label="Refunded" tone="text-success-fg" />
                        </div>
                    </Panel>

                    <Panel title={`Platform fees (last ${overview.data.fees.windowDays} days)`}>
                        {!overview.data.fees.byCurrency.length ? <Empty>No fees taken in this window.</Empty> : (
                            <ul className="divide-y divide-border">
                                {overview.data.fees.byCurrency.map((f: any) => (
                                    <li key={f.currency} className="flex justify-between px-4 py-3 text-[15px] sm:px-6">
                                        <span className="font-medium text-text">{f.currency}</span>
                                        <span className="tabular-nums text-text">{formatMinor(f.totalMinor, f.currency)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Panel>
                </div>
            )}

            <Panel
                title="Payouts"
                action={
                    <div className="w-full sm:w-52">
                        <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
                            {STATUSES.map((s) => <option key={s} value={s}>{s ? STATUS_LABEL[s] : 'All statuses'}</option>)}
                        </Select>
                    </div>
                }
            >
                {payouts.isLoading ? <LoadingBlock /> : !payouts.data?.data.length ? <Empty>No payouts match.</Empty> : (
                    <>
                        <Table>
                            <THead><tr><Th>When</Th><Th>Business</Th><Th>Amount</Th><Th>To</Th><Th>Status</Th><Th>Note</Th></tr></THead>
                            <tbody>
                                {payouts.data.data.map((p: any) => (
                                    <Tr key={p.id}>
                                        <Td className="whitespace-nowrap font-medium">{formatDateTime(p.createdAt)}</Td>
                                        <Td label="Business">{businessLink(p.tenantId, p.tenantName)}</Td>
                                        <Td label="Amount" className="whitespace-nowrap tabular-nums">{formatMinor(p.amountMinor, p.currency)}</Td>
                                        <Td label="To">{p.recipient.accountName}<p className="text-[13px] text-muted">{p.recipient.accountNumberMasked}</p></Td>
                                        <Td label="Status"><PayoutStatus status={p.status} /></Td>
                                        <Td label="Note">{p.failureReason ?? '—'}</Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                        {payouts.data.pagination.totalPages <= 1 ? (
                            <p className="border-t border-border px-4 py-3 text-[14px] text-muted sm:px-6">{payouts.data.pagination.total} payouts</p>
                        ) : (
                            <ListPager
                                page={page}
                                totalPages={payouts.data.pagination.totalPages}
                                onPage={setPage}
                                summary={`${payouts.data.pagination.total} payouts`}
                            />
                        )}
                    </>
                )}
            </Panel>

            <Panel
                title="Refunds"
                action={
                    <div className="w-full sm:w-52">
                        <Select aria-label="Refund state" value={refundState} onChange={(e) => setRefundState(e.target.value as typeof refundState)}>
                            <option value="pending">Waiting to retry</option><option value="refunding">In flight</option><option value="refunded">Refunded</option>
                        </Select>
                    </div>
                }
            >
                {refunds.isLoading ? <LoadingBlock /> : !refunds.data?.data.length ? <Empty>No refunds in this state.</Empty> : (
                    <Table>
                        <THead><tr><Th>Booking</Th><Th>Business</Th><Th>Amount</Th><Th>Attempts</Th><Th>Last error</Th><Th>Next try</Th></tr></THead>
                        <tbody>
                            {refunds.data.data.map((r: any) => (
                                <Tr key={r.bookingId}>
                                    <Td className="font-mono text-[13px] font-semibold">{r.reference}</Td>
                                    <Td label="Business">{businessLink(r.tenantId, r.tenantName)}</Td>
                                    <Td label="Amount" className="tabular-nums">{r.amount ?? '—'}</Td>
                                    <Td label="Attempts" className="tabular-nums">{r.attempts}</Td>
                                    <Td label="Last error">{r.lastError ?? '—'}</Td>
                                    <Td label="Next try" className="whitespace-nowrap">{formatDateTime(r.nextAttemptAt)}</Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>
        </div>
    );
}

function RefundFigure({ value, label, tone }: { value: number; label: string; tone: string }) {
    return (
        <div className="rounded-control bg-surface-2 px-2 py-3">
            <p className={`text-[1.75rem] font-bold leading-none tabular-nums ${tone}`}>{value}</p>
            <p className="mt-1 text-[13px] text-muted">{label}</p>
        </div>
    );
}
