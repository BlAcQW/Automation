'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Badge } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { Empty, isUnavailable, Panel, Table, Td, Th, Unavailable } from './parts';
import { formatMinor, timeAgo } from './format';

interface Attention {
    alerts: any;
    payouts: any | null;
    refunds: any | null;
    whatsapp: any;
    quota: any;
    handoffs: any;
    webhooks: any;
}

const SEVERITY_VARIANT: Record<string, 'red' | 'yellow' | 'blue'> = { critical: 'red', warning: 'yellow', info: 'blue' };

const orgLink = (id: string, name: string | null) => (
    <Link href={`/admin/tenants/${id}`} className="text-white hover:text-emerald-400 transition-colors">{name ?? id}</Link>
);

/** The home screen's answer to "what needs a person right now?". */
export function AttentionPanel() {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['admin', 'attention'],
        queryFn: async () => (await adminApi.get('/admin/attention')).data as Attention,
        refetchInterval: 60_000,
    });

    if (isLoading) return <div className="flex h-40 items-center justify-center"><BooklyDots size="md" /></div>;
    if (isError || !data) return <p className="text-sm text-red-400">Could not load the needs-attention list.</p>;

    const { alerts, payouts, refunds, whatsapp, quota, handoffs, webhooks } = data;
    const alertBadges = !isUnavailable(alerts) ? alerts.bySeverity : null;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-white">Needs attention</h2>
                {alertBadges && (
                    <>
                        <Badge variant="red">{alertBadges.critical} critical</Badge>
                        <Badge variant="yellow">{alertBadges.warning} warning</Badge>
                        <Badge variant="blue">{alertBadges.info} info</Badge>
                    </>
                )}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Panel title="Open alerts" action={<Link href="/admin/alerts" className="text-sm text-emerald-400 hover:underline">All alerts →</Link>}>
                    {isUnavailable(alerts) ? <Unavailable /> : !alerts.top.length ? <Empty>No critical or warning alerts. </Empty> : (
                        <Table>
                            <thead><tr><Th>Severity</Th><Th>Organisation</Th><Th>What happened</Th><Th>Seen</Th></tr></thead>
                            <tbody>
                                {alerts.top.map((a: any) => (
                                    <tr key={a.id} className="border-t border-white/5">
                                        <Td><Badge variant={SEVERITY_VARIANT[a.severity] ?? 'slate'}>{a.severity}</Badge></Td>
                                        <Td>{a.tenantId ? orgLink(a.tenantId, a.tenantName) : <span className="text-slate-500">Platform</span>}</Td>
                                        <Td><p>{a.message}</p><p className="font-mono text-xs text-slate-500">{a.kind} × {a.count}</p></Td>
                                        <Td className="whitespace-nowrap">{timeAgo(a.lastSeenAt)}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Panel>

                <Panel title="Conversations waiting for a person">
                    {isUnavailable(handoffs) ? <Unavailable /> : !handoffs.items.length ? (
                        <Empty>Nobody has waited more than {handoffs.olderThanMinutes} minutes.</Empty>
                    ) : (
                        <>
                            <p className="px-6 pt-3 text-xs text-slate-500">
                                {handoffs.count}{handoffs.capped ? '+' : ''} handed to staff more than {handoffs.olderThanMinutes} min ago with no reply.
                            </p>
                            <Table>
                                <thead><tr><Th>Customer</Th><Th>Organisation</Th><Th>Waiting</Th></tr></thead>
                                <tbody>
                                    {handoffs.items.map((h: any) => (
                                        <tr key={h.conversationId} className="border-t border-white/5">
                                            <Td>{h.customer}{h.reason && <p className="text-xs text-slate-500">{h.reason}</p>}</Td>
                                            <Td>{orgLink(h.tenantId, h.tenantName)}</Td>
                                            <Td className="whitespace-nowrap text-amber-300">{h.waitingMinutes} min</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </>
                    )}
                </Panel>

                {payouts !== null && (
                    <Panel title="Payouts that failed or are stuck">
                        {isUnavailable(payouts) ? <Unavailable /> : !payouts.items.length ? <Empty>No failed or stuck payouts.</Empty> : (
                            <Table>
                                <thead><tr><Th>Organisation</Th><Th>Amount</Th><Th>Status</Th><Th>Reason</Th></tr></thead>
                                <tbody>
                                    {payouts.items.map((p: any) => (
                                        <tr key={p.id} className="border-t border-white/5">
                                            <Td>{orgLink(p.tenantId, p.tenantName)}</Td>
                                            <Td className="tabular-nums">{formatMinor(p.amountMinor, p.currency)}</Td>
                                            <Td><Badge variant={p.status === 'FAILED' ? 'red' : 'yellow'}>{p.status}</Badge></Td>
                                            <Td>{p.failureReason ?? '—'}</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>
                )}

                {refunds !== null && (
                    <Panel title="Refunds waiting to be retried" action={<Link href="/admin/money" className="text-sm text-emerald-400 hover:underline">Money →</Link>}>
                        {isUnavailable(refunds) ? <Unavailable /> : !refunds.items.length ? <Empty>No refunds are failing.</Empty> : (
                            <Table>
                                <thead><tr><Th>Organisation</Th><Th>Attempts</Th><Th>Last error</Th></tr></thead>
                                <tbody>
                                    {refunds.items.map((r: any) => (
                                        <tr key={r.bookingId} className="border-t border-white/5">
                                            <Td>{orgLink(r.tenantId, r.tenantName)}</Td>
                                            <Td className="tabular-nums">{r.attempts}</Td>
                                            <Td>{r.lastError ?? '—'}</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>
                )}

                <Panel title="WhatsApp and templates">
                    {isUnavailable(whatsapp) ? <Unavailable /> : !whatsapp.notLive.length && !whatsapp.unapprovedTemplates.length ? (
                        <Empty>Every connected number is live and every template is approved.</Empty>
                    ) : (
                        <ul className="divide-y divide-white/5">
                            {whatsapp.notLive.map((w: any) => (
                                <li key={`wa-${w.tenantId}`} className="px-6 py-3 text-sm">
                                    {orgLink(w.tenantId, w.tenantName)} <Badge variant="red">Not live</Badge>
                                    <p className="text-xs text-slate-500">{w.reason}{w.displayNumber ? ` · ${w.displayNumber}` : ''}</p>
                                </li>
                            ))}
                            {whatsapp.unapprovedTemplates.map((t: any) => (
                                <li key={`tp-${t.tenantId}`} className="px-6 py-3 text-sm">
                                    {orgLink(t.tenantId, t.tenantName)} <Badge variant="yellow">{t.count} template{t.count === 1 ? '' : 's'} not approved</Badge>
                                    <p className="text-xs text-slate-500">{t.purposes.join(', ')}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>

                <Panel title={isUnavailable(quota) ? 'Close to their message quota' : `At ${quota.thresholdPercent}%+ of their message quota`}>
                    {isUnavailable(quota) ? <Unavailable /> : !quota.nearLimit.length ? <Empty>Nobody is near their limit.</Empty> : (
                        <>
                            <Table>
                                <thead><tr><Th>Organisation</Th><Th>Plan</Th><Th>Used</Th></tr></thead>
                                <tbody>
                                    {quota.nearLimit.map((q: any) => (
                                        <tr key={q.tenantId} className="border-t border-white/5">
                                            <Td>{orgLink(q.tenantId, q.tenantName)}</Td>
                                            <Td>{q.planId}</Td>
                                            <Td className="tabular-nums">{q.used.toLocaleString()} / {q.limit.toLocaleString()} ({q.percent}%)</Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                            {quota.truncated && <p className="px-6 pb-3 text-xs text-slate-500">Checked the {quota.scanned} newest active organisations.</p>}
                        </>
                    )}
                </Panel>

                <Panel title="Webhook deliveries failing (24h)">
                    {isUnavailable(webhooks) ? <Unavailable /> : !webhooks.byTenant.length ? <Empty>No failed webhook deliveries.</Empty> : (
                        <Table>
                            <thead><tr><Th>Organisation</Th><Th>Failed</Th></tr></thead>
                            <tbody>
                                {webhooks.byTenant.map((w: any) => (
                                    <tr key={w.tenantId} className="border-t border-white/5">
                                        <Td>{orgLink(w.tenantId, w.tenantName)}</Td>
                                        <Td className="tabular-nums">{w.count}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Panel>
            </div>
        </div>
    );
}
