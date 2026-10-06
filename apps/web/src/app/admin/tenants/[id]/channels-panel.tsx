'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Instagram, MessageCircle, Facebook, RefreshCw, Send, Unplug } from 'lucide-react';
import { Badge, Button } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Empty, Panel, ReasonModal } from '../../_components/parts';
import { errorMessage, formatDate, formatDateTime, timeAgo } from '../../_components/format';

type BadgeVariant = 'default' | 'blue' | 'yellow' | 'red' | 'purple' | 'orange' | 'slate';
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

const WA_STATE: Record<ChannelsData['whatsapp']['state'], { label: string; tone: string }> = {
    CONNECTED: { label: 'Connected', tone: 'text-emerald-400' },
    PROBLEM: { label: 'Problem', tone: 'text-red-400' },
    PENDING_CODE: { label: 'Pending OTP', tone: 'text-amber-300' },
    REGISTERING: { label: 'Code verified, registering', tone: 'text-amber-300' },
    NOT_CONNECTED: { label: 'Not connected', tone: 'text-slate-400' },
};

const QUALITY: Record<string, BadgeVariant> = { GREEN: 'default', YELLOW: 'yellow', RED: 'red' };

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
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-sm text-slate-200">{children}</dd>
        </div>
    );
}

function ChannelRow({ icon, name, connected, detail, action }: { icon: ReactNode; name: string; connected: boolean; detail: ReactNode; action?: ReactNode }) {
    return (
        <li className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 text-slate-400">{icon}</span>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                        {name} <Badge variant={connected ? 'default' : 'slate'}>{connected ? 'Connected' : 'Not connected'}</Badge>
                    </p>
                    <div className="mt-1 text-xs text-slate-400">{detail}</div>
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

    const { data, isLoading, isError, error } = useQuery({
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
        onSuccess: () => { toast.success('Disconnected; the organisation has been told'); setPending(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not disconnect')),
    });
    const resend = useMutation({
        mutationFn: async (codeMethod: 'SMS' | 'VOICE') =>
            (await adminApi.post(`/admin/tenants/${tenantId}/whatsapp/hosted/resend`, { codeMethod })).data,
        onSuccess: () => { toast.success('Code sent again'); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not resend the code')),
    });
    const healthCheck = useMutation({
        mutationFn: async () => (await adminApi.post(`/admin/tenants/${tenantId}/whatsapp/health-check`)).data.data,
        onSuccess: (r: any) => { toast.success(r?.problem ? 'Checked: there is a problem' : r?.transient ? 'Meta did not answer; kept the last readings' : 'Checked: healthy'); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Health check failed')),
    });

    if (isLoading) return <div id="channels"><Panel title="Channels"><Empty>Loading…</Empty></Panel></div>;
    if (isError || !data) {
        return <div id="channels"><Panel title="Channels"><p className="px-6 py-4 text-sm text-red-400">{errorMessage(error, 'Could not load channels.')}</p></Panel></div>;
    }

    const wa = data.whatsapp;
    const state = WA_STATE[wa.state];
    const mode = modeLabel(wa.mode, tenantName);
    const live = wa.state === 'CONNECTED' || wa.state === 'PROBLEM';

    return (
        <div id="channels" className="scroll-mt-24">
            <Panel title="Channels">
                {/* WhatsApp: the channel that carries the business, so it gets the room. */}
                <section className="border-b border-white/5 px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <MessageCircle className="mt-1 h-5 w-5 text-emerald-400" aria-hidden />
                            <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500">WhatsApp</p>
                                <p className={`text-2xl font-semibold ${state.tone}`}>{state.label}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    {mode && <Badge variant={wa.mode === 'BOOKLY_HOSTED' ? 'blue' : 'purple'}>{mode}</Badge>}
                                    {wa.billedBy && <span className="text-xs text-slate-500">Meta bills {wa.billedBy === 'BOOKLY' ? 'Bookly' : tenantName}</span>}
                                </div>
                            </div>
                        </div>
                        {mayManage && (
                            <div className="flex flex-wrap gap-2">
                                {wa.state === 'PENDING_CODE' && (
                                    <>
                                        <Button size="sm" variant="outline" isLoading={resend.isPending} onClick={() => resend.mutate('SMS')}><Send className="h-4 w-4" /> Resend OTP (SMS)</Button>
                                        <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate('VOICE')}>By voice call</Button>
                                    </>
                                )}
                                {live && (
                                    <Button size="sm" variant="outline" isLoading={healthCheck.isPending} onClick={() => healthCheck.mutate()}><RefreshCw className="h-4 w-4" /> Run health check</Button>
                                )}
                                {wa.state !== 'NOT_CONNECTED' && (
                                    <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'whatsapp' })}><Unplug className="h-4 w-4" /> Disconnect</Button>
                                )}
                            </div>
                        )}
                    </div>

                    {wa.health.problem && (
                        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
                            {wa.health.problemText ?? wa.health.problem}
                        </p>
                    )}
                    {wa.pending && (
                        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
                            {wa.pending.step === 'CODE_VERIFIED'
                                ? 'The code was accepted; registration with Meta has not finished. The owner can retry verify without a new code.'
                                : `Code sent by ${wa.pending.codeMethod === 'VOICE' ? 'voice call' : 'SMS'} ${timeAgo(wa.pending.codeSentAt)}. Waiting for the owner to enter it.`}
                        </p>
                    )}

                    {wa.state !== 'NOT_CONNECTED' && (
                        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                            <Fact label="Number">{wa.displayNumber ?? '—'}</Fact>
                            <Fact label="Display name">
                                {wa.verifiedName ?? '—'}
                                {wa.nameStatus && <span className="ml-1 text-xs text-slate-500">({wa.nameStatus.toLowerCase().replace(/_/g, ' ')})</span>}
                            </Fact>
                            <Fact label="Connected">
                                {wa.connectedAt ? formatDate(wa.connectedAt) : '—'}
                                {who(wa.connectedBy) && <span className="block text-xs text-slate-500">by {who(wa.connectedBy)}</span>}
                            </Fact>
                            <Fact label="Quality">
                                {wa.health.qualityRating
                                    ? <Badge variant={QUALITY[wa.health.qualityRating] ?? 'slate'}>{wa.health.qualityRating}</Badge>
                                    : <span className="text-slate-500">Not checked yet</span>}
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
                        <p className="mt-3 text-sm text-slate-500">
                            The owner connects from the dashboard or their own console.{!wa.hostedAvailable && ' Bookly-hosted numbers are not available on this server.'}
                        </p>
                    )}
                </section>

                <ul className="divide-y divide-white/5">
                    <ChannelRow
                        icon={<Instagram className="h-4 w-4" aria-hidden />}
                        name="Instagram"
                        connected={data.instagram.connected}
                        detail={data.instagram.connected
                            ? <>@{data.instagram.username} · connected {formatDate(data.instagram.connectedAt)}{who(data.instagram.connectedBy) ? ` by ${who(data.instagram.connectedBy)}` : ''} · last message {data.instagram.lastInboundAt ? timeAgo(data.instagram.lastInboundAt) : 'none yet'}</>
                            : 'Rides on the Facebook Page; connected together with Messenger.'}
                        action={mayManage && data.instagram.connected
                            ? <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'instagram' })}>Disconnect</Button>
                            : undefined}
                    />
                    <ChannelRow
                        icon={<Facebook className="h-4 w-4" aria-hidden />}
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
                    <div className="border-t border-white/5 px-6 py-4">
                        <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Recent channel events</p>
                        <ul className="space-y-1.5">
                            {data.recentEvents.slice(0, 8).map((e) => (
                                <li key={e.id} className="flex flex-wrap gap-x-2 text-xs text-slate-400">
                                    <span className="whitespace-nowrap text-slate-500">{formatDateTime(e.createdAt)}</span>
                                    <span className="text-slate-200">{EVENT_LABEL[e.action] ?? e.action}</span>
                                    {e.metadata?.mode && <span>({e.metadata.mode === 'BOOKLY_HOSTED' ? 'hosted' : 'own account'})</span>}
                                    <span>by {e.actorType === 'ADMIN' ? `Bookly admin ${who(e.actor) ?? ''}` : who(e.actor) ?? e.actorType.toLowerCase()}</span>
                                    {e.metadata?.reason && <span className="text-slate-500">· “{e.metadata.reason}”</span>}
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
