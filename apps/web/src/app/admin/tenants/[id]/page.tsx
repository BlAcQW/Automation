'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, Circle, Copy, Minus, PauseCircle, PlayCircle, LifeBuoy, Workflow } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Button, ErrorState, PageHeader, Select, StatusPill, buttonVariants } from '@bookingflow/ui';
import { useAdmin } from '../../admin-context';
import { Empty, LoadingBlock, Panel, ReasonModal, THead, Table, Td, Th, Tr, UsageBar } from '../../_components/parts';
import { errorMessage, formatDate, formatDateTime, formatMinor, timeAgo } from '../../_components/format';
import { ApiKeysPanel } from './api-keys-panel';
import { ChannelsPanel } from './channels-panel';
import { BotsPanel } from './bots-panel';
import { DangerZonePanel } from './danger-zone-panel';
import { PeoplePanel, type Person } from './people-panel';

interface Overview {
    tenant: any;
    checklist: Array<{ key: string; label: string; status: 'done' | 'todo' | 'na'; detail?: string }>;
    plan: { planId: string; limit: number; used: number; percent: number; overridden: boolean; cycleStart: string; cycleEnd: string };
    switches: { outbound: { pausedAt: string | null }; payouts: { pausedAt: string | null }; reason: string | null };
    staff: Person[];
    usage: Array<{ cycle: string; messages: number; platformSms: number }>;
    money: any | null;
    recentConversations: any[];
    audit: any[];
    supportSessions: any[];
}

type Pending =
    | { kind: 'pause'; which: 'outbound' | 'payouts' }
    | { kind: 'support' }
    | { kind: 'handoff'; conversationId: string }
    | null;

export default function OrganisationPage() {
    const { id } = useParams<{ id: string }>();
    const { admin, can } = useAdmin();
    const queryClient = useQueryClient();
    const [pending, setPending] = useState<Pending>(null);
    const [minutes, setMinutes] = useState(30);
    // The support token is shown once, in this page's memory only.
    const [grant, setGrant] = useState<{ token: string; sessionId: string; expiresAt: string } | null>(null);

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin', 'tenant-overview', id],
        queryFn: async () => (await adminApi.get(`/admin/tenants/${id}/overview`)).data as Overview,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-overview', id] });

    const setSwitch = useMutation({
        mutationFn: async (v: { which: 'outbound' | 'payouts'; paused: boolean; reason?: string }) =>
            (await adminApi.put(`/admin/tenants/${id}/switches/${v.which}`, { paused: v.paused, reason: v.reason })).data,
        onSuccess: (_d, v) => { toast.success(`${v.which === 'outbound' ? 'Outbound messages' : 'Payouts'} ${v.paused ? 'paused' : 'resumed'}`); setPending(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not change the switch')),
    });

    const startSupport = useMutation({
        mutationFn: async (reason: string) =>
            (await adminApi.post(`/admin/tenants/${id}/support-sessions`, { reason, minutes })).data,
        onSuccess: (d) => {
            setGrant({ token: d.token, sessionId: d.session.id, expiresAt: d.session.expiresAt });
            setPending(null);
            refresh();
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not start support access')),
    });

    const endSupport = useMutation({
        mutationFn: async (sessionId: string) => (await adminApi.post(`/admin/support-sessions/${sessionId}/end`)).data,
        onSuccess: () => { toast.success('Support session ended'); setGrant(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not end the session')),
    });

    const mintToken = useMutation({
        mutationFn: async (sessionId: string) => (await adminApi.post(`/admin/support-sessions/${sessionId}/token`)).data as { token: string; tokenExpiresInSeconds: number },
        onSuccess: (d, sessionId) => {
            const s = data?.supportSessions.find((x) => x.id === sessionId);
            setGrant({ token: d.token, sessionId, expiresAt: s?.expiresAt ?? new Date(Date.now() + d.tokenExpiresInSeconds * 1000).toISOString() });
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not issue a new token')),
    });

    const handoff = useMutation({
        mutationFn: async (v: { conversationId: string; reason: string }) =>
            (await adminApi.post(`/admin/conversations/${v.conversationId}/handoff`, { reason: v.reason })).data,
        onSuccess: () => { toast.success('Conversation handed to a person'); setPending(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not hand over the conversation')),
    });

    if (isLoading) return <LoadingBlock />;
    if (isError || !data) {
        return (
            <div className="space-y-4">
                <BackLink />
                <ErrorState title="We couldn't load this business" description={errorMessage(error, 'Check your connection and try again.')} onRetry={refresh} />
            </div>
        );
    }

    const { tenant, checklist, plan, switches, staff, usage, money, recentConversations, audit, supportSessions } = data;
    const live = supportSessions.filter((s) => !s.endedAt && new Date(s.expiresAt) > new Date());
    const pauseKinds = {
        outbound: { label: 'Outbound messages', permission: 'outbound:switch', hint: 'Stops every WhatsApp, SMS, email and webhook send for this business. Incoming messages and bookings keep working.' },
        payouts: { label: 'Payouts', permission: 'payouts:switch', hint: 'Stops withdrawals and automatic payouts. Balances keep accruing.' },
    } as const;

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow={<BackLink />}
                title={tenant.name}
                actions={
                    <>
                        {can('flows:read') && (
                            <Link href={`/admin/flows?tenantId=${tenant.id}`} className={buttonVariants({ variant: 'secondary' })}>
                                <Workflow className="h-4 w-4" aria-hidden /> Workflows
                            </Link>
                        )}
                        {can('support:access') && (
                            <Button variant="secondary" onClick={() => setPending({ kind: 'support' })}><LifeBuoy className="h-4 w-4" aria-hidden /> Support access</Button>
                        )}
                    </>
                }
            />
            <div className="-mt-3 flex flex-wrap items-center gap-2 text-[14px] text-muted">
                <StatusPill size="sm" status={tenant.isActive ? 'active' : 'inactive'} tone={tenant.isActive ? 'success' : 'error'} />
                <Badge variant="neutral">{tenant.vertical}</Badge>
                <Badge variant="neutral">mode: {tenant.conversationMode ?? 'vertical default'}</Badge>
                {tenant.activeFlowKey && <Badge variant="info">flow: {tenant.activeFlowKey}</Badge>}
                <span>Plan {tenant.planId}{tenant.subscriptionStatus ? ` · ${tenant.subscriptionStatus.toLowerCase()}` : ''}</span>
                <span>· joined {formatDate(tenant.createdAt)}</span>
            </div>

            {grant && (
                <div role="status" className="rounded-card border border-warning/40 bg-warning-soft p-4">
                    <p className="text-[15px] font-semibold text-warning-fg">
                        View-only support access is on until {formatDateTime(grant.expiresAt)}. Every request made with this token is audited.
                    </p>
                    <p className="mt-2 text-[14px] text-text">
                        The token lasts 15 minutes at most and only reads this business&apos;s data. You&apos;ll only see it here once; make a fresh one from this page while the session lasts.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <code className="min-w-0 basis-full truncate rounded-control bg-surface px-3 py-2 text-[13px] text-text sm:basis-auto sm:flex-1">{grant.token}</code>
                        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(grant.token).then(() => toast.success('Token copied'))}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
                        <Button size="sm" variant="secondary" onClick={() => mintToken.mutate(grant.sessionId)} isLoading={mintToken.isPending}>New token</Button>
                        <Button size="sm" variant="destructive" onClick={() => endSupport.mutate(grant.sessionId)} isLoading={endSupport.isPending}>End session</Button>
                    </div>
                </div>
            )}

            {live.length > 0 && !grant && (
                <p role="status" className="rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-[15px] text-warning-fg">
                    {live.length} support session{live.length === 1 ? ' is' : 's are'} live for this business.
                </p>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Panel title="Emergency switches">
                    <ul className="divide-y divide-border">
                        {(['outbound', 'payouts'] as const).map((which) => {
                            const at = switches[which].pausedAt;
                            const meta = pauseKinds[which];
                            return (
                                <li key={which} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                    <div>
                                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text">
                                            {meta.label} {at ? <StatusPill size="sm" status="paused" tone="error" label={`Paused ${timeAgo(at)}`} /> : <StatusPill size="sm" status="running" tone="success" />}
                                        </p>
                                        {at && switches.reason && <p className="mt-1 text-[14px] text-muted">Reason: {switches.reason}</p>}
                                        <p className="mt-1 text-[14px] text-muted">{meta.hint}</p>
                                    </div>
                                    {can(meta.permission) && (
                                        at ? (
                                            <Button size="sm" variant="secondary" isLoading={setSwitch.isPending} onClick={() => setSwitch.mutate({ which, paused: false })}><PlayCircle className="h-4 w-4" aria-hidden /> Resume</Button>
                                        ) : (
                                            <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'pause', which })}><PauseCircle className="h-4 w-4" aria-hidden /> Pause</Button>
                                        )
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </Panel>

                <Panel title="Setup checklist">
                    <ul className="divide-y divide-border">
                        {checklist.map((c) => (
                            <li key={c.key} className="flex items-start gap-3 px-4 py-3 sm:px-6">
                                {c.status === 'done' ? <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-soft"><Check className="h-3.5 w-3.5 text-success-fg" strokeWidth={2.75} aria-label="done" /></span>
                                    : c.status === 'todo' ? <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning-soft"><Circle className="h-3.5 w-3.5 text-warning-fg" aria-label="to do" /></span>
                                        : <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2"><Minus className="h-3.5 w-3.5 text-muted" aria-label="not applicable" /></span>}
                                <div>
                                    {c.key === 'whatsapp' ? (
                                        <a href="#channels" className="text-[15px] font-medium text-text underline-offset-2 hover:text-primary hover:underline">{c.label} →</a>
                                    ) : (
                                        <p className={`text-[15px] ${c.status === 'na' ? 'text-muted' : 'text-text'}`}>{c.label}</p>
                                    )}
                                    {c.detail && <p className="text-[14px] text-muted">{c.detail}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Panel>

                <Panel title="Plan and quota">
                    <div className="space-y-3 px-4 py-5 sm:px-6">
                        <div className="flex items-baseline justify-between gap-3">
                            <p className="text-[15px] text-text">{plan.used.toLocaleString()} of {plan.limit.toLocaleString()} messages{plan.overridden ? ' (custom limit)' : ''}</p>
                            <p className="text-[15px] font-semibold tabular-nums text-text">{plan.percent}%</p>
                        </div>
                        <UsageBar percent={plan.percent} />
                        <p className="text-[14px] text-muted">Cycle {formatDate(plan.cycleStart)} to {formatDate(plan.cycleEnd)}</p>
                    </div>
                    {usage.length > 0 && (
                        <Table>
                            <THead><tr><Th>Cycle start</Th><Th>Messages</Th><Th>Platform SMS</Th></tr></THead>
                            <tbody>
                                {usage.map((u) => (
                                    <Tr key={u.cycle}><Td>{u.cycle}</Td><Td label="Messages" className="tabular-nums">{u.messages.toLocaleString()}</Td><Td label="Platform SMS" className="tabular-nums">{u.platformSms.toLocaleString()}</Td></Tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Panel>

                {money && (
                    <Panel title="Money">
                        {!money.wallet ? <Empty>No wallet yet.</Empty> : (
                            <div className="grid grid-cols-2 gap-4 px-4 py-5 sm:px-6">
                                <div><p className="text-[14px] text-muted">Available</p><p className="text-section-heading tabular-nums text-text">{formatMinor(money.wallet.availableMinor, money.wallet.currency)}</p></div>
                                <div><p className="text-[14px] text-muted">Pending</p><p className="text-section-heading tabular-nums text-text">{formatMinor(money.wallet.pendingMinor, money.wallet.currency)}</p></div>
                            </div>
                        )}
                        <p className="px-4 pb-2 text-[14px] text-muted sm:px-6">Refunds waiting to retry: {money.refundsPending}</p>
                        {money.payoutsByStatus.length > 0 && (
                            <Table>
                                <THead><tr><Th>Payouts</Th><Th>Count</Th><Th>Total</Th></tr></THead>
                                <tbody>
                                    {money.payoutsByStatus.map((p: any) => (
                                        <Tr key={p.status}><Td><StatusPill size="sm" status={p.status} /></Td><Td label="Count" className="tabular-nums">{p.count}</Td><Td label="Total" className="tabular-nums">{formatMinor(p.totalMinor, money.wallet?.currency)}</Td></Tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>
                )}
            </div>

            <ChannelsPanel tenantId={tenant.id} tenantName={tenant.name} />

            <BotsPanel tenantId={tenant.id} tenantName={tenant.name} />

            <PeoplePanel tenantId={tenant.id} tenantActive={tenant.isActive} vertical={tenant.vertical} people={staff} />

            <Panel title="Recent conversations">
                {!recentConversations.length ? <Empty>No conversations yet.</Empty> : (
                    <Table>
                        <THead><tr><Th>Customer</Th><Th>Channel</Th><Th>State</Th><Th>Last message</Th><Th /></tr></THead>
                        <tbody>
                            {recentConversations.map((c) => (
                                <Tr key={c.id}>
                                    <Td><span className="font-semibold">{c.customerName ?? c.customer ?? 'Unknown'}</span>{c.customerName && c.customer ? <span className="ml-2 text-[13px] text-muted">{c.customer}</span> : null}</Td>
                                    <Td label="Channel">{c.channel}</Td>
                                    <Td label="State"><Badge variant={c.state === 'HUMAN_ACTIVE' ? 'warning' : 'neutral'}>{c.state === 'HUMAN_ACTIVE' ? 'With a person' : 'Automatic replies'}</Badge></Td>
                                    <Td label="Last message">{timeAgo(c.lastInboundAt)}</Td>
                                    <Td>
                                        {c.state !== 'HUMAN_ACTIVE' && can('conversations:handoff') && (
                                            <Button size="sm" variant="secondary" className="w-full md:w-auto" onClick={() => setPending({ kind: 'handoff', conversationId: c.id })}>Hand to a person</Button>
                                        )}
                                    </Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>

            <ApiKeysPanel tenantId={tenant.id} tenantName={tenant.name} />

            {supportSessions.length > 0 && (
                <Panel title="Support sessions">
                    <Table>
                        <THead><tr><Th>Started</Th><Th>Reason</Th><Th>Until</Th><Th /></tr></THead>
                        <tbody>
                            {supportSessions.map((s) => {
                                const isLive = !s.endedAt && new Date(s.expiresAt) > new Date();
                                const mine = s.adminId === admin?.id;
                                return (
                                    <Tr key={s.id}>
                                        <Td className="whitespace-nowrap">{formatDateTime(s.createdAt)}</Td>
                                        <Td label="Reason">{s.reason}</Td>
                                        <Td label="Until" className="whitespace-nowrap">{s.endedAt ? `Ended ${timeAgo(s.endedAt)}` : isLive ? formatDateTime(s.expiresAt) : 'Expired'}</Td>
                                        <Td>
                                            {isLive && mine && (
                                                <div className="flex flex-wrap gap-2 md:justify-end">
                                                    <Button size="sm" variant="secondary" onClick={() => mintToken.mutate(s.id)} isLoading={mintToken.isPending}>New token</Button>
                                                    <Button size="sm" variant="destructive" onClick={() => endSupport.mutate(s.id)}>End</Button>
                                                </div>
                                            )}
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Panel>
            )}

            <Panel title="Audit trail" action={can('audit:read') ? <Link href={`/admin/audit?tenantId=${tenant.id}`} className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-primary hover:underline">Full log →</Link> : undefined}>
                {!audit.length ? <Empty>Nothing recorded yet.</Empty> : (
                    <Table>
                        <THead><tr><Th>When</Th><Th>Action</Th><Th>Actor</Th></tr></THead>
                        <tbody>
                            {audit.map((a) => (
                                <Tr key={a.id}>
                                    <Td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                                    <Td label="Action" className="font-mono text-[13px]">{a.action}</Td>
                                    <Td label="Who">{a.actorType}</Td>
                                </Tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>

            <DangerZonePanel tenantId={tenant.id} tenantName={tenant.name} isActive={tenant.isActive} />

            <ReasonModal
                isOpen={pending?.kind === 'pause'}
                title={pending?.kind === 'pause' ? `Pause ${pauseKinds[pending.which].label.toLowerCase()}` : ''}
                description={pending?.kind === 'pause' ? pauseKinds[pending.which].hint : undefined}
                confirmLabel="Pause"
                busy={setSwitch.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => pending?.kind === 'pause' && setSwitch.mutate({ which: pending.which, paused: true, reason })}
            />
            <ReasonModal
                isOpen={pending?.kind === 'support'}
                title="Start view-only support access"
                description={
                    <div className="space-y-3">
                        <p>You&apos;ll get a short-lived, view-only token for {tenant.name}. Everything you open is recorded against your name and this reason.</p>
                        <Select id="support-minutes" label="How long" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                            {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                        </Select>
                    </div>
                }
                confirmLabel="Start access"
                busy={startSupport.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => startSupport.mutate(reason)}
            />
            <ReasonModal
                isOpen={pending?.kind === 'handoff'}
                title="Hand this conversation to a person"
                description="Automatic replies stop and the conversation moves to the business's staff inbox."
                confirmLabel="Hand over"
                minLength={3}
                busy={handoff.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => pending?.kind === 'handoff' && handoff.mutate({ conversationId: pending.conversationId, reason })}
            />
        </div>
    );
}

function BackLink() {
    return (
        <Link href="/admin/tenants" className="inline-flex min-h-[44px] items-center gap-1 text-[14px] font-medium text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden /> All businesses
        </Link>
    );
}
