'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Badge, ErrorState, SectionHeading, StatusPill, type StatusTone } from '@bookingflow/ui';
import { Empty, isUnavailable, LoadingBlock, Panel, Table, THead, Td, Th, Tr, Unavailable } from './parts';
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

/** Alert severity → pill tone (icon + word + colour). */
export const SEVERITY_TONE: Record<string, StatusTone> = { critical: 'error', warning: 'warning', info: 'neutral' };

const orgLink = (id: string, name: string | null) => (
    <Link href={`/admin/tenants/${id}`} className="font-medium text-text underline-offset-2 hover:text-primary hover:underline">{name ?? id}</Link>
);

const panelLink = (href: string, label: string) => (
    <Link href={href} className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-primary hover:underline">{label} →</Link>
);

/** The home screen's answer to "what needs a person right now?". */
export function AttentionPanel() {
    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['admin', 'attention'],
        queryFn: async () => (await adminApi.get('/admin/attention')).data as Attention,
        refetchInterval: 60_000,
    });

    if (isLoading) return <LoadingBlock rows={5} label="Loading what needs attention…" />;
    if (isError || !data) {
        return (
            <ErrorState
                title="We couldn't load the needs-attention list"
                onRetry={() => refetch()}
                isRetrying={isRefetching}
            />
        );
    }

    const { alerts, payouts, refunds, whatsapp, quota, handoffs, webhooks } = data;
    const alertBadges = !isUnavailable(alerts) ? alerts.bySeverity : null;

    return (
        <div className="space-y-6">
            <SectionHeading
                title="Needs attention"
                actions={alertBadges && (
                    <div className="flex flex-wrap gap-2">
                        <StatusPill status="critical" tone="error" label={`${alertBadges.critical} critical`} />
                        <StatusPill status="warning" label={`${alertBadges.warning} warning`} />
                        <StatusPill status="info" tone="neutral" label={`${alertBadges.info} info`} />
                    </div>
                )}
            />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Panel title="Open alerts" action={panelLink('/admin/alerts', 'All alerts')}>
                    {isUnavailable(alerts) ? <Unavailable /> : !alerts.top.length ? <Empty>No critical or warning alerts. All calm.</Empty> : (
                        <Table>
                            <THead><tr><Th>Severity</Th><Th>Business</Th><Th>What happened</Th><Th>Seen</Th></tr></THead>
                            <tbody>
                                {alerts.top.map((a: any) => (
                                    <Tr key={a.id}>
                                        <Td label="Severity"><StatusPill size="sm" status={a.severity} tone={SEVERITY_TONE[a.severity] ?? 'neutral'} /></Td>
                                        <Td label="Business">{a.tenantId ? orgLink(a.tenantId, a.tenantName) : <span className="text-muted">Platform</span>}</Td>
                                        <Td label="What happened"><p>{a.message}</p><p className="font-mono text-[13px] text-muted">{a.kind} × {a.count}</p></Td>
                                        <Td label="Seen" className="whitespace-nowrap text-muted">{timeAgo(a.lastSeenAt)}</Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Panel>

                <Panel title="Customers waiting for a person">
                    {isUnavailable(handoffs) ? <Unavailable /> : !handoffs.items.length ? (
                        <Empty>Nobody has waited more than {handoffs.olderThanMinutes} minutes.</Empty>
                    ) : (
                        <>
                            <p className="px-4 pt-3 text-[14px] text-muted sm:px-6">
                                {handoffs.count}{handoffs.capped ? '+' : ''} handed to staff more than {handoffs.olderThanMinutes} min ago with no reply.
                            </p>
                            <Table>
                                <THead><tr><Th>Customer</Th><Th>Business</Th><Th>Waiting</Th></tr></THead>
                                <tbody>
                                    {handoffs.items.map((h: any) => (
                                        <Tr key={h.conversationId}>
                                            <Td label="Customer">{h.customer}{h.reason && <p className="text-[13px] text-muted">{h.reason}</p>}</Td>
                                            <Td label="Business">{orgLink(h.tenantId, h.tenantName)}</Td>
                                            <Td label="Waiting" className="whitespace-nowrap"><StatusPill size="sm" status="pending" label={`${h.waitingMinutes} min`} /></Td>
                                        </Tr>
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
                                <THead><tr><Th>Business</Th><Th>Amount</Th><Th>Status</Th><Th>Reason</Th></tr></THead>
                                <tbody>
                                    {payouts.items.map((p: any) => (
                                        <Tr key={p.id}>
                                            <Td label="Business">{orgLink(p.tenantId, p.tenantName)}</Td>
                                            <Td label="Amount" className="whitespace-nowrap tabular-nums">{formatMinor(p.amountMinor, p.currency)}</Td>
                                            <Td label="Status"><StatusPill size="sm" status={p.status} tone={p.status === 'FAILED' ? 'error' : 'warning'} /></Td>
                                            <Td label="Reason">{p.failureReason ?? '—'}</Td>
                                        </Tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>
                )}

                {refunds !== null && (
                    <Panel title="Refunds waiting to be retried" action={panelLink('/admin/money', 'Money')}>
                        {isUnavailable(refunds) ? <Unavailable /> : !refunds.items.length ? <Empty>No refunds are failing.</Empty> : (
                            <Table>
                                <THead><tr><Th>Business</Th><Th>Attempts</Th><Th>Last error</Th></tr></THead>
                                <tbody>
                                    {refunds.items.map((r: any) => (
                                        <Tr key={r.bookingId}>
                                            <Td label="Business">{orgLink(r.tenantId, r.tenantName)}</Td>
                                            <Td label="Attempts" className="tabular-nums">{r.attempts}</Td>
                                            <Td label="Last error">{r.lastError ?? '—'}</Td>
                                        </Tr>
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
                        <ul className="divide-y divide-border">
                            {whatsapp.notLive.map((w: any) => (
                                <li key={`wa-${w.tenantId}`} className="space-y-1 px-4 py-3 text-[15px] sm:px-6">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {orgLink(w.tenantId, w.tenantName)} <StatusPill size="sm" status="failed" label="Not live" />
                                    </div>
                                    <p className="text-[13px] text-muted">{w.reason}{w.displayNumber ? ` · ${w.displayNumber}` : ''}</p>
                                </li>
                            ))}
                            {whatsapp.unapprovedTemplates.map((t: any) => (
                                <li key={`tp-${t.tenantId}`} className="space-y-1 px-4 py-3 text-[15px] sm:px-6">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {orgLink(t.tenantId, t.tenantName)} <StatusPill size="sm" status="pending" label={`${t.count} template${t.count === 1 ? '' : 's'} not approved`} />
                                    </div>
                                    <p className="text-[13px] text-muted">{t.purposes.join(', ')}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </Panel>

                <Panel title={isUnavailable(quota) ? 'Close to their message limit' : `At ${quota.thresholdPercent}%+ of their message limit`}>
                    {isUnavailable(quota) ? <Unavailable /> : !quota.nearLimit.length ? <Empty>Nobody is near their limit.</Empty> : (
                        <>
                            <Table>
                                <THead><tr><Th>Business</Th><Th>Plan</Th><Th>Used</Th></tr></THead>
                                <tbody>
                                    {quota.nearLimit.map((q: any) => (
                                        <Tr key={q.tenantId}>
                                            <Td label="Business">{orgLink(q.tenantId, q.tenantName)}</Td>
                                            <Td label="Plan"><Badge variant="neutral">{q.planId}</Badge></Td>
                                            <Td label="Used" className="tabular-nums">{q.used.toLocaleString()} / {q.limit.toLocaleString()} ({q.percent}%)</Td>
                                        </Tr>
                                    ))}
                                </tbody>
                            </Table>
                            {quota.truncated && <p className="px-4 pb-3 text-[13px] text-muted sm:px-6">Checked the {quota.scanned} newest active businesses.</p>}
                        </>
                    )}
                </Panel>

                <Panel title="Webhook deliveries failing (24h)">
                    {isUnavailable(webhooks) ? <Unavailable /> : !webhooks.byTenant.length ? <Empty>No failed webhook deliveries.</Empty> : (
                        <Table>
                            <THead><tr><Th>Business</Th><Th>Failed</Th></tr></THead>
                            <tbody>
                                {webhooks.byTenant.map((w: any) => (
                                    <Tr key={w.tenantId}>
                                        <Td label="Business">{orgLink(w.tenantId, w.tenantName)}</Td>
                                        <Td label="Failed" className="tabular-nums">{w.count}</Td>
                                    </Tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Panel>
            </div>
        </div>
    );
}
