'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { ErrorState, PageHeader, Select, StatusPill } from '@bookingflow/ui';
import { Empty, LoadingBlock, Panel, THead, Table, Td, Th, Tr, UsageBar } from '../_components/parts';
import { formatRate } from '../_components/format';

export default function AdminMessagingHealthPage() {
    const [days, setDays] = useState(7);
    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['admin', 'messaging', days],
        queryFn: async () => (await adminApi.get(`/admin/messaging/health?days=${days}`)).data,
    });

    return (
        <div className="space-y-6">
            <PageHeader
                title="Messaging health"
                subtitle="How outbound messages are landing, what Meta billed, and platform SMS spend."
                actions={
                    <div className="w-full sm:w-48">
                        <Select aria-label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                            {[1, 7, 14, 30].map((d) => <option key={d} value={d}>Last {d} day{d === 1 ? '' : 's'}</option>)}
                        </Select>
                    </div>
                }
            />

            {isLoading ? <LoadingBlock />
                : isError || !data ? <ErrorState title="We couldn't load messaging health" onRetry={() => refetch()} isRetrying={isRefetching} /> : (
                    <>
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                            <Stat label="Outbound messages" value={data.totals.total.toLocaleString()} />
                            <Stat label="Delivered or read" value={formatRate(data.totals.deliveryRate)} hint="of messages with a receipt" />
                            <Stat label="Failed" value={formatRate(data.totals.failureRate)} hint={`${data.totals.failed.toLocaleString()} messages`} warn={(data.totals.failureRate ?? 0) > 0.05} />
                            <Stat label="No receipt yet" value={data.totals.noReceipt.toLocaleString()} hint="SMS, email, or still in flight" />
                        </div>

                        <Panel title="By business (worst failure rate first)">
                            {!data.tenants.length ? <Empty>No outbound messages in this window.</Empty> : (
                                <Table>
                                    <THead><tr><Th>Business</Th><Th>Messages</Th><Th>Delivered / read</Th><Th>Failed</Th><Th>Failure rate</Th><Th>No receipt</Th></tr></THead>
                                    <tbody>
                                        {data.tenants.map((t: any) => (
                                            <Tr key={t.tenantId}>
                                                <Td><Link href={`/admin/tenants/${t.tenantId}`} className="font-semibold text-text hover:text-primary">{t.tenantName ?? t.tenantId}</Link></Td>
                                                <Td label="Messages" className="tabular-nums">{t.total.toLocaleString()}</Td>
                                                <Td label="Delivered / read" className="tabular-nums">{formatRate(t.deliveryRate)}</Td>
                                                <Td label="Failed" className="tabular-nums">{t.failed.toLocaleString()}</Td>
                                                <Td label="Failure rate"><StatusPill size="sm" status="rate" tone={(t.failureRate ?? 0) >= 0.2 ? 'error' : (t.failureRate ?? 0) >= 0.05 ? 'warning' : 'success'} label={formatRate(t.failureRate)} /></Td>
                                                <Td label="No receipt" className="tabular-nums">{t.noReceipt.toLocaleString()}</Td>
                                            </Tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Panel>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <Panel title="What Meta billed these as">
                                {!data.billing.length ? <Empty>No billing data in this window.</Empty> : (
                                    <Table>
                                        <THead><tr><Th>Category</Th><Th>Messages</Th><Th>Billable</Th><Th>Free</Th></tr></THead>
                                        <tbody>
                                            {data.billing.map((b: any) => (
                                                <Tr key={b.category}>
                                                    <Td className="capitalize text-text">{b.category}</Td><Td label="Messages" className="tabular-nums">{b.total.toLocaleString()}</Td>
                                                    <Td label="Billable" className="tabular-nums">{b.billable.toLocaleString()}</Td><Td label="Free" className="tabular-nums">{b.free.toLocaleString()}</Td>
                                                </Tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                )}
                            </Panel>

                            <Panel title={`Platform SMS this cycle (budget ${data.sms.budgetPerTenant} per business)`}>
                                {!data.sms.tenants.length ? <Empty>No platform SMS used this cycle.</Empty> : (
                                    <ul className="divide-y divide-border">
                                        {data.sms.tenants.map((s: any) => (
                                            <li key={s.tenantId} className="space-y-1.5 px-4 py-3 sm:px-6">
                                                <div className="flex flex-wrap justify-between gap-2 text-[15px]">
                                                    <Link href={`/admin/tenants/${s.tenantId}`} className="text-text hover:text-primary">{s.tenantName ?? s.tenantId}</Link>
                                                    <span className="tabular-nums text-text">{s.used} / {s.budget} ({s.percent}%)</span>
                                                </div>
                                                <UsageBar percent={s.percent} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <p className="px-4 py-3 text-[14px] text-muted sm:px-6">Total this cycle: {data.sms.totalUsed.toLocaleString()} messages.</p>
                            </Panel>
                        </div>
                    </>
                )}
        </div>
    );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
    return (
        <div className="rounded-card border border-border p-4 bg-surface shadow-card">
            <p className="text-[14px] font-medium text-muted">{label}</p>
            <p className={`mt-2 text-[1.75rem] font-bold leading-none tabular-nums ${warn ? 'text-warning-fg' : 'text-text'}`}>{value}</p>
            {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
        </div>
    );
}
