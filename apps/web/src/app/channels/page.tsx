'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Instagram, Facebook, Loader2, ArrowRight, Info, Smartphone, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import {
    PageHeader,
    Card,
    CardContent,
    Button,
    Modal,
    StatusPill,
    ConfirmDialog,
    ErrorState,
    SkeletonCard,
    TickPop,
    Stagger,
    StaggerItem,
} from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';
import { useAuth } from '@/lib/auth';

declare global {
    interface Window {
        FB: any;
        fbAsyncInit: () => void;
    }
}

interface ChannelState {
    connected: boolean;
    label: string | null;
    awaitingCode?: boolean;
    billedByMeta: boolean;
    requiresPage?: boolean;
}

interface ChannelsStatus {
    whatsapp: ChannelState;
    messenger: ChannelState;
    instagram: ChannelState;
}

interface PageOption {
    pageId: string;
    pageName: string;
    instagramUsername: string | null;
    hasInstagram: boolean;
}

/**
 * Facebook Login scopes for messaging. Instagram rides on the Page, so its
 * permissions come along with the Page ones in a single consent screen —
 * asking twice would double the drop-off on the only step that matters.
 */
const FB_SCOPES = [
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_manage_messages',
].join(',');

export default function ChannelsPage() {
    const { user } = useAuth();
    const isOwner = user?.role === 'OWNER';

    const [status, setStatus] = useState<ChannelsStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    // Page picker — we never auto-select, because a person may administer a
    // Page that is not their business.
    const [pages, setPages] = useState<PageOption[] | null>(null);
    const [selectionToken, setSelectionToken] = useState<string | null>(null);
    const [savingPage, setSavingPage] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await api.get('/channels/status');
            setStatus(res.data);
        } catch {
            setError('Could not load your channels.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    function connectFacebook() {
        const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
        if (!window.FB) {
            setError('Facebook could not load. Turn off any ad-blocker for this page and refresh.');
            return;
        }
        if (!appId) {
            setError('Facebook app is not configured. Contact support.');
            return;
        }

        setConnecting(true);
        setError(null);
        setNotice(null);

        window.FB.login(
            async (response: any) => {
                const code = response?.authResponse?.code;
                if (!code) {
                    setConnecting(false);
                    setError('Connection cancelled.');
                    return;
                }
                try {
                    const res = await api.post('/channels/facebook/pages', { code });
                    setPages(res.data.pages);
                    setSelectionToken(res.data.selectionToken);
                } catch (err: any) {
                    setError(err?.response?.data?.message ?? 'Could not read your Facebook Pages.');
                } finally {
                    setConnecting(false);
                }
            },
            { config_id: undefined, response_type: 'code', override_default_response_type: true, scope: FB_SCOPES },
        );
    }

    async function choosePage(pageId: string) {
        if (!selectionToken) return;
        setSavingPage(pageId);
        setError(null);
        try {
            const res = await api.post('/channels/facebook/select', {
                selectionToken,
                pageId,
                includeInstagram: true,
            });
            setPages(null);
            setSelectionToken(null);
            const message = res.data.instagramUsername
                ? `Connected ${res.data.pageName} and @${res.data.instagramUsername}.`
                : `Connected ${res.data.pageName}. No Instagram account is linked to this Page yet.`;
            setNotice(message);
            notify.success('Channel connected');
            await fetchStatus();
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Could not connect that Page.');
        } finally {
            setSavingPage(null);
        }
    }

    async function disconnectFacebook() {
        setError(null);
        setDisconnecting(true);
        try {
            await api.post('/channels/facebook/disconnect');
            setNotice(null);
            notify.success('Facebook and Instagram disconnected');
            await fetchStatus();
        } catch {
            setError('Could not disconnect.');
        } finally {
            setDisconnecting(false);
            setConfirmDisconnect(false);
        }
    }

    const fbConnected = !!status?.messenger.connected;

    const connectButton = (
        <Button onClick={connectFacebook} disabled={connecting || !isOwner} isLoading={connecting} loadingText="Connecting…">
            <Facebook className="h-4 w-4" aria-hidden />
            Connect
        </Button>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Your channels"
                subtitle="Where your customers can reach you. Bookly replies on every channel you connect."
            />

            {error && status && (
                <div role="alert" className="rounded-control border border-error/30 bg-error-soft p-4 text-[15px] text-error-fg">
                    {error}
                </div>
            )}
            {notice && (
                <Card>
                    <CardContent className="flex items-center gap-4">
                        <TickPop key={notice} size={44} label="Channel connected" />
                        <p className="text-[15px] text-text">{notice}</p>
                    </CardContent>
                </Card>
            )}

            {loading ? (
                <div aria-busy="true" className="space-y-4">
                    <span className="sr-only">Loading…</span>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            ) : !status ? (
                <ErrorState
                    description={error ?? 'We could not load your channels.'}
                    onRetry={() => { setLoading(true); setError(null); fetchStatus(); }}
                />
            ) : (
                <Stagger className="space-y-4">
                    {/* WhatsApp — owns its own setup screen, so this card links out. */}
                    <StaggerItem>
                        <ChannelCard
                            icon={<Smartphone className="h-5 w-5 text-wa-teal" aria-hidden />}
                            iconClass="bg-wa-green/15"
                            name="WhatsApp"
                            blurb="Connect your WhatsApp so customers can book, pay deposits and get reminders. The only channel Meta charges for."
                            connected={!!status.whatsapp.connected}
                            label={status.whatsapp.label ?? null}
                            pending={status.whatsapp.awaitingCode ? 'Waiting for your code' : null}
                            action={
                                <Link href="/whatsapp" className="block">
                                    <Button variant="secondary" fullWidth tabIndex={-1}>
                                        {status.whatsapp.connected ? 'Manage' : 'Set up'}
                                        <ArrowRight className="h-4 w-4" aria-hidden />
                                    </Button>
                                </Link>
                            }
                        />
                    </StaggerItem>

                    <StaggerItem>
                        <ChannelCard
                            icon={<Instagram className="h-5 w-5 text-text" aria-hidden />}
                            name="Instagram"
                            blurb="Reply to DMs and take bookings. Free — Meta charges nothing for Instagram messages."
                            connected={!!status.instagram.connected}
                            label={status.instagram.label ?? null}
                            pending={fbConnected && !status.instagram.connected
                                ? 'Your Page is connected, but no Instagram account is linked to it yet'
                                : null}
                            action={fbConnected ? null : connectButton}
                        />
                    </StaggerItem>

                    <StaggerItem>
                        <ChannelCard
                            icon={<Facebook className="h-5 w-5 text-text" aria-hidden />}
                            name="Facebook Messenger"
                            blurb="Reply to messages sent to your Page. Free — Meta charges nothing for Messenger."
                            connected={fbConnected}
                            label={status.messenger.label ?? null}
                            action={
                                fbConnected ? (
                                    <Button variant="secondary" onClick={() => setConfirmDisconnect(true)} disabled={!isOwner}>
                                        Disconnect
                                    </Button>
                                ) : connectButton
                            }
                        />
                    </StaggerItem>

                    {!isOwner && (
                        <p className="flex items-center gap-2 text-small text-muted">
                            <Lock className="h-4 w-4 shrink-0" aria-hidden />
                            Only the account owner can connect or disconnect channels.
                        </p>
                    )}

                    <StaggerItem>
                        <Card className="bg-surface-2 shadow-none">
                            <CardContent className="flex gap-3 text-[15px] text-text">
                                <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                                <div className="space-y-2">
                                    <p>
                                        Instagram and Messenger connect together, because Instagram messages
                                        come through your Facebook Page. You will pick which Page to use.
                                    </p>
                                    <p className="text-muted">
                                        Reminders only go out on WhatsApp. On Instagram and Messenger, Meta
                                        does not allow messages once a customer has been quiet for 24 hours —
                                        so those bookings are reminded by SMS instead.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </StaggerItem>
                </Stagger>
            )}

            {/* Page picker. Never auto-selected: a person may administer several
                Pages, and wiring the wrong one sends someone else's messages here. */}
            <Modal
                isOpen={!!pages}
                onClose={() => { setPages(null); setSelectionToken(null); }}
                title="Which Page is your business?"
                description="Pick the Page your customers message. We never choose for you."
            >
                <div className="space-y-2">
                    {(pages ?? []).map((p) => (
                        <button
                            key={p.pageId}
                            type="button"
                            onClick={() => choosePage(p.pageId)}
                            disabled={!!savingPage}
                            className="min-h-[56px] w-full rounded-control border border-border bg-surface p-4 text-left transition-colors duration-ui hover:border-primary hover:bg-primary-soft disabled:opacity-50"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[15px] font-semibold text-text">{p.pageName}</p>
                                    <p className="mt-0.5 text-small text-muted">
                                        {p.hasInstagram
                                            ? `Instagram @${p.instagramUsername} will connect too`
                                            : 'No Instagram account linked to this Page'}
                                    </p>
                                </div>
                                {savingPage === p.pageId
                                    ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden />
                                    : <ArrowRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />}
                            </div>
                        </button>
                    ))}
                </div>
            </Modal>

            <ConfirmDialog
                isOpen={confirmDisconnect}
                onClose={() => setConfirmDisconnect(false)}
                onConfirm={disconnectFacebook}
                title="Disconnect Facebook and Instagram?"
                description="Bookly will stop replying to Messenger and Instagram messages. You can connect again any time."
                confirmLabel="Disconnect"
                isLoading={disconnecting}
            />
        </div>
    );
}

interface ChannelCardProps {
    icon: React.ReactNode;
    iconClass?: string;
    name: string;
    blurb: string;
    connected: boolean;
    label: string | null;
    pending?: string | null;
    action: React.ReactNode;
}

function ChannelCard({ icon, iconClass, name, blurb, connected, label, pending, action }: ChannelCardProps) {
    return (
        <Card>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-control ${iconClass ?? 'bg-surface-2'}`}>
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[17px] font-bold text-text">{name}</h2>
                        {connected
                            ? <StatusPill status="connected" size="sm" />
                            : <StatusPill status="not_connected" tone="neutral" label="Not connected" size="sm" />}
                    </div>
                    <p className="mt-1 text-[15px] text-muted">
                        {connected && label ? label : blurb}
                    </p>
                    {pending && (
                        <StatusPill status="pending" label={pending} size="sm" className="mt-2 whitespace-normal" />
                    )}
                </div>
                {action && <div className="w-full shrink-0 sm:w-auto [&>button]:w-full sm:[&>button]:w-auto">{action}</div>}
            </CardContent>
        </Card>
    );
}
