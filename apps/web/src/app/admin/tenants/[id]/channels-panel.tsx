'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Instagram, Phone, Facebook, RefreshCw, Send, Unplug } from 'lucide-react';
import { Badge, Button, ErrorState, SkeletonList, StatusPill, type StatusTone } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Empty, Panel, ReasonModal } from '../../_components/parts';
import { errorMessage, formatDate, formatDateTime, timeAgo } from '../../_components/format';


interface Person { id: string; name: string | null; email: string | null }

interface ChannelsData {
    tenant: { id: string; name: string };
    whatsapp: {
        state: 'NOT_CONNECTED' | 'PENDING_CODE' | 'REGISTERING' | 'CONNECTED' | 'PROBLEM';
        connected: boolean;
        mode: 'OWN_ACCOUNT' | 'BOOKLY_HOSTED' | 'MANUAL' | null;
        displayNumber: string | null;
        verifiedName: string | null;
        nameStatus: string | null;
        billedBy: 'BOOKLY' | 'ORGANISATION' | null;
        connectedAt: string | null;
        connectedBy: Person | null;
        pending: null | { step: string; codeMethod: string | null; codeSentAt: string | null; resendAvailableAt: string | null };
        health: {
            qualityRating: string | null; messagingLimit: string | null; metaStatus: string | null;
            problem: string | null; problemText: string | null; checkedAt: string | null; tokenExpiresAt: string | null;
        };
        lastInboundAt: string | null;
        hostedAvailable: boolean;
    };
    instagram: { connected: boolean; username: string | null; connectedAt: string | null; connectedBy: Person | null; lastInboundAt: string | null };
    messenger: { connected: boolean; pageName: string | null; connectedAt: string | null; connectedBy: Person | null; lastInboundAt: string | null };
    recentEvents: Array<{ id: string; action: string; actorType: string; actor: Person | null; createdAt: string; metadata: any }>;
}

type Pending = { kind: 'whatsapp' } | { kind: 'facebook' } | { kind: 'instagram' } | null;

const WA_STATE: Record<ChannelsData['whatsapp']['state'], { label: string; tone: StatusTone }> = {
    CONNECTED: { label: 'Connected', tone: 'success' },
    PROBLEM: { label: 'Has a problem', tone: 'error' },
    PENDING_CODE: { label: 'Waiting for the code', tone: 'warning' },
    REGISTERING: { label: 'Code accepted, finishing setup', tone: 'warning' },
    NOT_CONNECTED: { label: 'Not connected', tone: 'neutral' },
};

const QUALITY: Record<string, StatusTone> = { GREEN: 'success', YELLOW: 'warning', RED: 'error' };

const EVENT_LABEL: Record<string, string> = {
    'whatsapp.connected': 'WhatsApp connected',
    'whatsapp.disconnected': 'WhatsApp disconnected',
    'whatsapp.connect_failed': 'WhatsApp connect failed',
    'whatsapp.hosted_started': 'Hosted number added, code sent',
    'whatsapp.hosted_code_resent': 'Code re-sent',
    'whatsapp.hosted_registered': 'Hosted number registered',
    'whatsapp.health_checked': 'Health check run',
    'channels.facebook_connected': 'Facebook Page connected',
    'channels.facebook_disconnected': 'Facebook Page disconnected',
    'channels.instagram_disconnected': 'Instagram disconnected',
};

const who = (p: Person | null) => (p ? p.name ?? p.email ?? 'a user' : null);

function modeLabel(mode: ChannelsData['whatsapp']['mode'], tenantName: string): string | null {
    if (mode === 'BOOKLY_HOSTED') return 'Bookly-hosted';
    if (mode === 'OWN_ACCOUNT') return `${tenantName}'s own account`;
    if (mode === 'MANUAL') return `${tenantName}'s own account (manual)`;
    return null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt className="text-[13px] font-medium text-muted">{label}</dt>
            <dd className="mt-0.5 break-words text-[15px] text-text">{children}</dd>
        </div>
    );
}

function ChannelRow({ icon, name, connected, detail, action }: { icon: ReactNode; name: string; connected: boolean; detail: ReactNode; action?: ReactNode }) {
    return (
        <li className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text">{icon}</span>
                <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text">
                        {name} <StatusPill size="sm" status={connected ? 'connected' : 'inactive'} label={connected ? 'Connected' : 'Not connected'} />
                    </p>
                    <div className="mt-1 break-words text-[14px] text-muted">{detail}</div>
                </div>
            </div>
            {action}
        </li>
    );
}

/**
 * Every messaging channel of one organisation for platform admins: WhatsApp
 * (with health), Instagram and Messenger, plus the support actions. Buttons
 * are hidden without channels:manage; the API enforces it regardless.
 */
export function ChannelsPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
    const { can } = useAdmin();
    const queryClient = useQueryClient();
    const [pending, setPending] = useState<Pending>(null);
    const queryKey = ['admin', 'tenant-channels', tenantId];
    const mayManage = can('channels:manage');

    const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
        queryKey,
        queryFn: async () => (await adminApi.get(`/admin/tenants/${tenantId}/channels`)).data.data as ChannelsData,
    });
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-overview', tenantId] });
    };

    const disconnect = useMutation({
        mutationFn: async (v: { channel: 'whatsapp' | 'facebook' | 'instagram'; reason: string }) =>
            (await adminApi.post(`/admin/tenants/${tenantId}/${v.channel}/disconnect`, { reason: v.reason })).data,
        onSuccess: () => { toast.success("Disconnected. We've let the business know."); setPending(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, "Couldn't disconnect. Let's try again.")),
    });
    const resend = useMutation({
        mutationFn: async (codeMethod: 'SMS' | 'VOICE') =>
            (await adminApi.post(`/admin/tenants/${tenantId}/whatsapp/hosted/resend`, { codeMethod })).data,
        onSuccess: () => { toast.success('Code sent again'); refresh(); },
        onError: (err) => toast.error(errorMessage(err, "Couldn't resend the code. Let's try again.")),
    });
    const healthCheck = useMutation({
        mutationFn: async () => (await adminApi.post(`/admin/tenants/${tenantId}/whatsapp/health-check`)).data.data,
        onSuccess: (r: any) => { toast.success(r?.problem ? 'Checked: there is a problem' : r?.transient ? 'Meta did not answer; kept the last readings' : 'Checked: healthy'); refresh(); },
        onError: (err) => toast.error(errorMessage(err, "The health check didn't finish. Let's try again.")),
    });

    if (isLoading) {
        return (
            <div id="channels">
                <Panel title="Channels">
                    <div aria-busy="true" className="px-4 sm:px-6"><span className="sr-only">Loading channels…</span><SkeletonList rows={3} /></div>
                </Panel>
            </div>
        );
    }
    if (isError || !data) {
        return (
            <div id="channels">
                <Panel title="Channels">
                    <ErrorState title="We couldn't load the channels" description={errorMessage(error, 'Check your connection and try again.')} onRetry={() => refetch()} isRetrying={isRefetching} />
                </Panel>
            </div>
        );
    }

    const wa = data.whatsapp;
    const state = WA_STATE[wa.state];
    const mode = modeLabel(wa.mode, tenantName);
    const live = wa.state === 'CONNECTED' || wa.state === 'PROBLEM';

    return (
        <div id="channels" className="scroll-mt-24">
            <Panel title="Channels">
                {/* WhatsApp: the channel that carries the business, so it gets the room. */}
                <section className="border-b border-border px-4 py-5 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                                <Phone className="h-5 w-5" aria-hidden />
                            </span>
                            <div>
                                <p className="text-[15px] font-semibold text-text">WhatsApp</p>
                                <StatusPill className="mt-1" status={wa.state} tone={state.tone} label={state.label} />
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {mode && <Badge variant="info">{mode}</Badge>}
                                    {wa.billedBy && <span className="text-[14px] text-muted">Meta bills {wa.billedBy === 'BOOKLY' ? 'Bookly' : tenantName}</span>}
                                </div>
                            </div>
                        </div>
                        {mayManage && (
                            <div className="flex flex-wrap gap-2">
                                {wa.state === 'PENDING_CODE' && (
                                    <>
                                        <Button size="sm" variant="secondary" isLoading={resend.isPending} onClick={() => resend.mutate('SMS')}><Send className="h-4 w-4" aria-hidden /> Resend code by SMS</Button>
                                        <Button size="sm" variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate('VOICE')}>By voice call</Button>
                                    </>
                                )}
                                {live && (
                                    <Button size="sm" variant="secondary" isLoading={healthCheck.isPending} onClick={() => healthCheck.mutate()}><RefreshCw className="h-4 w-4" aria-hidden /> Run health check</Button>
                                )}
                                {wa.state !== 'NOT_CONNECTED' && (
                                    <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'whatsapp' })}><Unplug className="h-4 w-4" aria-hidden /> Disconnect</Button>
                                )}
                            </div>
                        )}
                    </div>

                    {wa.health.problem && (
                        <p role="alert" className="mt-4 rounded-control border border-error/40 bg-error-soft px-3 py-2 text-[14px] text-error-fg">
                            {wa.health.problemText ?? wa.health.problem}
                        </p>
                    )}
                    {wa.pending && (
                        <p className="mt-4 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[14px] text-warning-fg">
                            {wa.pending.step === 'CODE_VERIFIED'
                                ? "The code was accepted, but Meta hasn't finished setting up the number. The owner can try again without a new code."
                                : `Code sent by ${wa.pending.codeMethod === 'VOICE' ? 'voice call' : 'SMS'} ${timeAgo(wa.pending.codeSentAt)}. Waiting for the owner to enter it.`}
                        </p>
                    )}

                    {wa.state !== 'NOT_CONNECTED' && (
                        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 min-[400px]:grid-cols-2 sm:grid-cols-3">
                            <Fact label="Number">{wa.displayNumber ?? '—'}</Fact>
                            <Fact label="Display name">
                                {wa.verifiedName ?? '—'}
                                {wa.nameStatus && <span className="ml-1 text-[13px] text-muted">({wa.nameStatus.toLowerCase().replace(/_/g, ' ')})</span>}
                            </Fact>
                            <Fact label="Connected">
                                {wa.connectedAt ? formatDate(wa.connectedAt) : '—'}
                                {who(wa.connectedBy) && <span className="block text-[13px] text-muted">by {who(wa.connectedBy)}</span>}
                            </Fact>
                            <Fact label="Quality">
                                {wa.health.qualityRating
                                    ? <StatusPill size="sm" status={wa.health.qualityRating} tone={QUALITY[wa.health.qualityRating] ?? 'neutral'} />
                                    : <span className="text-muted">Not checked yet</span>}
                            </Fact>
                            <Fact label="Messaging limit">{wa.health.messagingLimit?.replace(/^TIER_/, '') ?? '—'}</Fact>
                            <Fact label="Meta status">{wa.health.metaStatus ?? '—'}</Fact>
                            <Fact label="Token expires">
                                {wa.mode === 'BOOKLY_HOSTED' ? 'Platform token' : wa.health.tokenExpiresAt ? formatDateTime(wa.health.tokenExpiresAt) : 'Never / unknown'}
                            </Fact>
                            <Fact label="Last message received">{wa.lastInboundAt ? timeAgo(wa.lastInboundAt) : 'None yet'}</Fact>
                            <Fact label="Last health check">{wa.health.checkedAt ? timeAgo(wa.health.checkedAt) : 'Not yet'}</Fact>
                        </dl>
                    )}
                    {wa.state === 'NOT_CONNECTED' && (
                        <p className="mt-3 text-[15px] text-muted">
                            The owner connects from their dashboard or their own console.{!wa.hostedAvailable && " Bookly-hosted numbers aren't available on this server."}
                        </p>
                    )}
                </section>

                <ul className="divide-y divide-border">
                    <ChannelRow
                        icon={<Instagram className="h-5 w-5" aria-hidden />}
                        name="Instagram"
                        connected={data.instagram.connected}
                        detail={data.instagram.connected
                            ? <>@{data.instagram.username} · connected {formatDate(data.instagram.connectedAt)}{who(data.instagram.connectedBy) ? ` by ${who(data.instagram.connectedBy)}` : ''} · last message {data.instagram.lastInboundAt ? timeAgo(data.instagram.lastInboundAt) : 'none yet'}</>
                            : 'Works through the Facebook Page, so it connects together with Messenger.'}
                        action={mayManage && data.instagram.connected
                            ? <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'instagram' })}>Disconnect</Button>
                            : undefined}
                    />
                    <ChannelRow
                        icon={<Facebook className="h-5 w-5" aria-hidden />}
                        name="Messenger"
                        connected={data.messenger.connected}
                        detail={data.messenger.connected
                            ? <>{data.messenger.pageName} · connected {formatDate(data.messenger.connectedAt)}{who(data.messenger.connectedBy) ? ` by ${who(data.messenger.connectedBy)}` : ''} · last message {data.messenger.lastInboundAt ? timeAgo(data.messenger.lastInboundAt) : 'none yet'}</>
                            : 'No Facebook Page connected.'}
                        action={mayManage && data.messenger.connected
                            ? <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'facebook' })}>Disconnect</Button>
                            : undefined}
                    />
                </ul>

                {data.recentEvents.length > 0 && (
                    <div className="border-t border-border px-4 py-4 sm:px-6">
                        <p className="mb-2 text-[14px] font-semibold text-text">Recent channel events</p>
                        <ul className="space-y-2">
                            {data.recentEvents.slice(0, 8).map((e) => (
                                <li key={e.id} className="flex flex-wrap gap-x-2 text-[14px] text-muted">
                                    <span className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</span>
                                    <span className="text-text">{EVENT_LABEL[e.action] ?? e.action}</span>
                                    {e.metadata?.mode && <span>({e.metadata.mode === 'BOOKLY_HOSTED' ? 'hosted' : 'own account'})</span>}
                                    <span>by {e.actorType === 'ADMIN' ? `Bookly admin ${who(e.actor) ?? ''}` : who(e.actor) ?? e.actorType.toLowerCase()}</span>
                                    {e.metadata?.reason && <span className="text-muted">· “{e.metadata.reason}”</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Panel>

            <ReasonModal
                isOpen={pending?.kind === 'whatsapp'}
                title={`Disconnect WhatsApp for ${tenantName}`}
                description={`${wa.displayNumber ?? 'The number'} stops sending and receiving at once.${wa.mode === 'BOOKLY_HOSTED' ? ' The number is removed from Bookly’s WhatsApp account.' : ' Bookly unsubscribes from their WhatsApp Business Account.'} The owner gets an in-app notice with your reason.`}
                confirmLabel="Disconnect WhatsApp"
                busy={disconnect.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => disconnect.mutate({ channel: 'whatsapp', reason })}
            />
            <ReasonModal
                isOpen={pending?.kind === 'facebook'}
                title={`Disconnect Facebook for ${tenantName}`}
                description="Messenger and Instagram both stop (Instagram rides on the Page). The owner gets an in-app notice with your reason."
                confirmLabel="Disconnect Facebook"
                busy={disconnect.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => disconnect.mutate({ channel: 'facebook', reason })}
            />
            <ReasonModal
                isOpen={pending?.kind === 'instagram'}
                title={`Disconnect Instagram for ${tenantName}`}
                description="Instagram messages stop reaching Bookly; Messenger stays connected. The owner gets an in-app notice with your reason."
                confirmLabel="Disconnect Instagram"
                busy={disconnect.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => disconnect.mutate({ channel: 'instagram', reason })}
            />
        </div>
    );
}
