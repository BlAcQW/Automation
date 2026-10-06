'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Badge } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { Empty, Panel, Table, Td, Th, UsageBar } from '../_components/parts';
import { formatRate } from '../_components/format';

export default function AdminMessagingHealthPage() {
    const [days, setDays] = useState(7);
    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'messaging', days],
        queryFn: async () => (await adminApi.get(`/admin/messaging/health?days=${days}`)).data,
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Messaging health</h1>
                    <p className="text-slate-400">How outbound messages are landing, what Meta billed, and platform SMS spend.</p>
                </div>
                <select aria-label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-white">
                    {[1, 7, 14, 30].map((d) => <option key={d} value={d}>Last {d} day{d === 1 ? '' : 's'}</option>)}
                </select>
            </div>

            {isLoading ? <div className="flex h-40 items-center justify-center"><BooklyDots size="md" /></div>
                : isError || !data ? <p className="text-red-400">Could not load messaging health.</p> : (
                    <>
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                            <Stat label="Outbound messages" value={data.totals.total.toLocaleString()} />
                            <Stat label="Delivered or read" value={formatRate(data.totals.deliveryRate)} hint="of messages with a receipt" />
                            <Stat label="Failed" value={formatRate(data.totals.failureRate)} hint={`${data.totals.failed.toLocaleString()} messages`} warn={(data.totals.failureRate ?? 0) > 0.05} />
                            <Stat label="No receipt yet" value={data.totals.noReceipt.toLocaleString()} hint="SMS, email, or still in flight" />
                        </div>

                        <Panel title="By organisation (worst failure rate first)">
                            {!data.tenants.length ? <Empty>No outbound messages in this window.</Empty> : (
                                <Table>
                                    <thead><tr><Th>Organisation</Th><Th>Messages</Th><Th>Delivered / read</Th><Th>Failed</Th><Th>Failure rate</Th><Th>No receipt</Th></tr></thead>
                                    <tbody>
                                        {data.tenants.map((t: any) => (
                                            <tr key={t.tenantId} className="border-t border-white/5">
                                                <Td><Link href={`/admin/tenants/${t.tenantId}`} className="text-white hover:text-emerald-400">{t.tenantName ?? t.tenantId}</Link></Td>
                                                <Td className="tabular-nums">{t.total.toLocaleString()}</Td>
                                                <Td className="tabular-nums">{formatRate(t.deliveryRate)}</Td>
                                                <Td className="tabular-nums">{t.failed.toLocaleString()}</Td>
                                                <Td><Badge variant={(t.failureRate ?? 0) >= 0.2 ? 'red' : (t.failureRate ?? 0) >= 0.05 ? 'yellow' : 'default'}>{formatRate(t.failureRate)}</Badge></Td>
                                                <Td className="tabular-nums">{t.noReceipt.toLocaleString()}</Td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Panel>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <Panel title="What Meta billed these as">
                                {!data.billing.length ? <Empty>No billing data in this window.</Empty> : (
                                    <Table>
                                        <thead><tr><Th>Category</Th><Th>Messages</Th><Th>Billable</Th><Th>Free</Th></tr></thead>
                                        <tbody>
                                            {data.billing.map((b: any) => (
                                                <tr key={b.category} className="border-t border-white/5">
                                                    <Td className="capitalize text-white">{b.category}</Td><Td className="tabular-nums">{b.total.toLocaleString()}</Td>
                                                    <Td className="tabular-nums">{b.billable.toLocaleString()}</Td><Td className="tabular-nums">{b.free.toLocaleString()}</Td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                )}
                            </Panel>

                            <Panel title={`Platform SMS this cycle (budget ${data.sms.budgetPerTenant} per organisation)`}>
                                {!data.sms.tenants.length ? <Empty>No platform SMS used this cycle.</Empty> : (
                                    <ul className="divide-y divide-white/5">
                                        {data.sms.tenants.map((s: any) => (
                                            <li key={s.tenantId} className="space-y-1.5 px-6 py-3">
                                                <div className="flex justify-between text-sm">
                                                    <Link href={`/admin/tenants/${s.tenantId}`} className="text-white hover:text-emerald-400">{s.tenantName ?? s.tenantId}</Link>
                                                    <span className="tabular-nums text-slate-300">{s.used} / {s.budget} ({s.percent}%)</span>
                                                </div>
                                                <UsageBar percent={s.percent} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <p className="px-6 py-3 text-xs text-slate-500">Total this cycle: {data.sms.totalUsed.toLocaleString()} messages.</p>
                            </Panel>
                        </div>
                    </>
                )}
        </div>
    );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
    return (
        <div className="rounded-2xl border border-white/5 p-4 glass-card">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? 'text-amber-300' : 'text-white'}`}>{value}</p>
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
    );
}
