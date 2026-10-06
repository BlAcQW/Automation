'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, Circle, Copy, Minus, PauseCircle, PlayCircle, LifeBuoy, Workflow } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Button } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useAdmin } from '../../admin-context';
import { Empty, Panel, ReasonModal, Table, Td, Th, UsageBar } from '../../_components/parts';
import { errorMessage, formatDate, formatDateTime, formatMinor, timeAgo } from '../../_components/format';

interface Overview {
    tenant: any;
    checklist: Array<{ key: string; label: string; status: 'done' | 'todo' | 'na'; detail?: string }>;
    plan: { planId: string; limit: number; used: number; percent: number; overridden: boolean; cycleStart: string; cycleEnd: string };
    switches: { outbound: { pausedAt: string | null }; payouts: { pausedAt: string | null }; reason: string | null };
    staff: any[];
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

    if (isLoading) return <div className="flex h-64 items-center justify-center"><BooklyDots size="md" /></div>;
    if (isError || !data) {
        return (
            <div className="space-y-4">
                <BackLink />
                <p className="text-red-400">{errorMessage(error, 'Could not load this organisation.')}</p>
            </div>
        );
    }

    const { tenant, checklist, plan, switches, staff, usage, money, recentConversations, audit, supportSessions } = data;
    const live = supportSessions.filter((s) => !s.endedAt && new Date(s.expiresAt) > new Date());
    const pauseKinds = {
        outbound: { label: 'Outbound messages', permission: 'outbound:switch', hint: 'Stops every WhatsApp, SMS, email and webhook send for this organisation. Inbound and bookings keep working.' },
        payouts: { label: 'Payouts', permission: 'payouts:switch', hint: 'Stops withdrawals and automatic payouts. Balances keep accruing.' },
    } as const;

    return (
        <div className="space-y-6">
            <BackLink />

            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">{tenant.name}</h1>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                        <Badge variant={tenant.isActive ? 'default' : 'red'}>{tenant.isActive ? 'Active' : 'Inactive'}</Badge>
                        <Badge variant="slate">{tenant.vertical}</Badge>
                        <Badge variant="slate">mode: {tenant.conversationMode ?? 'vertical default'}</Badge>
                        {tenant.activeFlowKey && <Badge variant="purple">flow: {tenant.activeFlowKey}</Badge>}
                        <span>Plan {tenant.planId}{tenant.subscriptionStatus ? ` · ${tenant.subscriptionStatus.toLowerCase()}` : ''}</span>
                        <span>· created {formatDate(tenant.createdAt)}</span>
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {can('flows:read') && (
                        <Link href={`/admin/flows?tenantId=${tenant.id}`}>
                            <Button variant="outline"><Workflow className="h-4 w-4" /> Workflows</Button>
                        </Link>
                    )}
                    {can('support:access') && (
                        <Button variant="outline" onClick={() => setPending({ kind: 'support' })}><LifeBuoy className="h-4 w-4" /> Support access</Button>
                    )}
                </div>
            </div>

            {grant && (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                    <p className="text-sm font-medium text-sky-200">
                        Read-only support access is on until {formatDateTime(grant.expiresAt)}. Every request made with this token is audited.
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                        The token is short-lived (15 min at most) and only works for GET requests to this organisation. It is shown once here; mint a fresh one from this page while the session lasts.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-slate-900/70 px-2 py-1 text-xs text-slate-300">{grant.token}</code>
                        <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(grant.token).then(() => toast.success('Token copied'))}><Copy className="h-4 w-4" /> Copy</Button>
                        <Button size="sm" variant="outline" onClick={() => mintToken.mutate(grant.sessionId)} isLoading={mintToken.isPending}>New token</Button>
                        <Button size="sm" variant="destructive" onClick={() => endSupport.mutate(grant.sessionId)} isLoading={endSupport.isPending}>End session</Button>
                    </div>
                </div>
            )}

            {live.length > 0 && !grant && (
                <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-sm text-sky-200">
                    {live.length} support session{live.length === 1 ? ' is' : 's are'} live for this organisation.
                </p>
            )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Panel title="Emergency switches">
                    <ul className="divide-y divide-white/5">
                        {(['outbound', 'payouts'] as const).map((which) => {
                            const at = switches[which].pausedAt;
                            const meta = pauseKinds[which];
                            return (
                                <li key={which} className="flex items-center justify-between gap-4 px-6 py-4">
                                    <div>
                                        <p className="text-sm font-medium text-white">
                                            {meta.label} {at ? <Badge variant="red">Paused {timeAgo(at)}</Badge> : <Badge variant="default">Running</Badge>}
                                        </p>
                                        {at && switches.reason && <p className="mt-1 text-xs text-slate-400">Reason: {switches.reason}</p>}
                                        <p className="mt-1 text-xs text-slate-500">{meta.hint}</p>
                                    </div>
                                    {can(meta.permission) && (
                                        at ? (
                                            <Button size="sm" variant="outline" isLoading={setSwitch.isPending} onClick={() => setSwitch.mutate({ which, paused: false })}><PlayCircle className="h-4 w-4" /> Resume</Button>
                                        ) : (
                                            <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'pause', which })}><PauseCircle className="h-4 w-4" /> Pause</Button>
                                        )
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </Panel>

                <Panel title="Setup checklist">
                    <ul className="divide-y divide-white/5">
                        {checklist.map((c) => (
                            <li key={c.key} className="flex items-start gap-3 px-6 py-3">
                                {c.status === 'done' ? <Check className="mt-0.5 h-4 w-4 text-emerald-400" aria-label="done" />
                                    : c.status === 'todo' ? <Circle className="mt-0.5 h-4 w-4 text-amber-400" aria-label="to do" />
                                        : <Minus className="mt-0.5 h-4 w-4 text-slate-600" aria-label="not applicable" />}
                                <div>
                                    <p className={`text-sm ${c.status === 'na' ? 'text-slate-500' : 'text-white'}`}>{c.label}</p>
                                    {c.detail && <p className="text-xs text-slate-500">{c.detail}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Panel>

                <Panel title="Plan and quota">
                    <div className="space-y-3 px-6 py-5">
                        <div className="flex items-baseline justify-between">
                            <p className="text-sm text-slate-300">{plan.used.toLocaleString()} of {plan.limit.toLocaleString()} messages{plan.overridden ? ' (custom limit)' : ''}</p>
                            <p className="text-sm tabular-nums text-white">{plan.percent}%</p>
                        </div>
                        <UsageBar percent={plan.percent} />
                        <p className="text-xs text-slate-500">Cycle {formatDate(plan.cycleStart)} to {formatDate(plan.cycleEnd)}</p>
                    </div>
                    {usage.length > 0 && (
                        <Table>
                            <thead><tr><Th>Cycle start</Th><Th>Messages</Th><Th>Platform SMS</Th></tr></thead>
                            <tbody>
                                {usage.map((u) => (
                                    <tr key={u.cycle} className="border-t border-white/5"><Td>{u.cycle}</Td><Td className="tabular-nums">{u.messages.toLocaleString()}</Td><Td className="tabular-nums">{u.platformSms.toLocaleString()}</Td></tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Panel>

                {money && (
                    <Panel title="Money">
                        {!money.wallet ? <Empty>No wallet yet.</Empty> : (
                            <div className="grid grid-cols-2 gap-4 px-6 py-5">
                                <div><p className="text-xs text-slate-500">Available</p><p className="text-lg font-semibold tabular-nums text-white">{formatMinor(money.wallet.availableMinor, money.wallet.currency)}</p></div>
                                <div><p className="text-xs text-slate-500">Pending</p><p className="text-lg font-semibold tabular-nums text-white">{formatMinor(money.wallet.pendingMinor, money.wallet.currency)}</p></div>
                            </div>
                        )}
                        <p className="px-6 pb-2 text-xs text-slate-500">Refunds waiting to retry: {money.refundsPending}</p>
                        {money.payoutsByStatus.length > 0 && (
                            <Table>
                                <thead><tr><Th>Payouts</Th><Th>Count</Th><Th>Total</Th></tr></thead>
                                <tbody>
                                    {money.payoutsByStatus.map((p: any) => (
                                        <tr key={p.status} className="border-t border-white/5"><Td>{p.status}</Td><Td className="tabular-nums">{p.count}</Td><Td className="tabular-nums">{formatMinor(p.totalMinor, money.wallet?.currency)}</Td></tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Panel>
                )}
            </div>

            <Panel title={`Staff (${staff.length})`}>
                {!staff.length ? <Empty>No users.</Empty> : (
                    <Table>
                        <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th></tr></thead>
                        <tbody>
                            {staff.map((u) => (
                                <tr key={u.id} className="border-t border-white/5">
                                    <Td className="text-white">{u.name}</Td><Td>{u.email}</Td><Td>{u.role}</Td>
                                    <Td><Badge variant={u.isActive ? 'default' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>

            <Panel title="Recent conversations">
                {!recentConversations.length ? <Empty>No conversations yet.</Empty> : (
                    <Table>
                        <thead><tr><Th>Customer</Th><Th>Channel</Th><Th>State</Th><Th>Last message</Th><Th /></tr></thead>
                        <tbody>
                            {recentConversations.map((c) => (
                                <tr key={c.id} className="border-t border-white/5">
                                    <Td className="text-white">{c.customerName ?? c.customer ?? 'Unknown'}{c.customerName && c.customer ? <span className="ml-2 text-xs text-slate-500">{c.customer}</span> : null}</Td>
                                    <Td>{c.channel}</Td>
                                    <Td><Badge variant={c.state === 'HUMAN_ACTIVE' ? 'yellow' : 'slate'}>{c.state === 'HUMAN_ACTIVE' ? 'With a person' : 'Bot'}</Badge></Td>
                                    <Td>{timeAgo(c.lastInboundAt)}</Td>
                                    <Td>
                                        {c.state !== 'HUMAN_ACTIVE' && can('conversations:handoff') && (
                                            <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'handoff', conversationId: c.id })}>Hand to a person</Button>
                                        )}
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>

            {supportSessions.length > 0 && (
                <Panel title="Support sessions">
                    <Table>
                        <thead><tr><Th>Started</Th><Th>Reason</Th><Th>Until</Th><Th /></tr></thead>
                        <tbody>
                            {supportSessions.map((s) => {
                                const isLive = !s.endedAt && new Date(s.expiresAt) > new Date();
                                const mine = s.adminId === admin?.id;
                                return (
                                    <tr key={s.id} className="border-t border-white/5">
                                        <Td className="whitespace-nowrap">{formatDateTime(s.createdAt)}</Td>
                                        <Td>{s.reason}</Td>
                                        <Td className="whitespace-nowrap">{s.endedAt ? `Ended ${timeAgo(s.endedAt)}` : isLive ? formatDateTime(s.expiresAt) : 'Expired'}</Td>
                                        <Td>
                                            {isLive && mine && (
                                                <div className="flex gap-2 justify-end">
                                                    <Button size="sm" variant="outline" onClick={() => mintToken.mutate(s.id)} isLoading={mintToken.isPending}>New token</Button>
                                                    <Button size="sm" variant="destructive" onClick={() => endSupport.mutate(s.id)}>End</Button>
                                                </div>
                                            )}
                                        </Td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Panel>
            )}

            <Panel title="Audit trail" action={can('audit:read') ? <Link href={`/admin/audit?tenantId=${tenant.id}`} className="text-sm text-emerald-400 hover:underline">Full log →</Link> : undefined}>
                {!audit.length ? <Empty>Nothing recorded yet.</Empty> : (
                    <Table>
                        <thead><tr><Th>When</Th><Th>Action</Th><Th>Actor</Th></tr></thead>
                        <tbody>
                            {audit.map((a) => (
                                <tr key={a.id} className="border-t border-white/5">
                                    <Td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                                    <Td className="font-mono text-xs">{a.action}</Td>
                                    <Td>{a.actorType}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Panel>

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
                title="Start read-only support access"
                description={
                    <div className="space-y-2">
                        <p>You will get a short-lived read-only token for {tenant.name}. Everything you open is recorded against your name and this reason.</p>
                        <label className="flex items-center gap-2 text-slate-300">Duration
                            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-white">
                                {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                            </select>
                        </label>
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
                description="The bot stops replying and the conversation appears in the organisation's staff queue."
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
        <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> All tenants
        </Link>
    );
}
