'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { MessageCircle, Instagram, Facebook, Loader2, ArrowRight, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
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
            setNotice(
                res.data.instagramUsername
                    ? `Connected ${res.data.pageName} and @${res.data.instagramUsername}.`
                    : `Connected ${res.data.pageName}. No Instagram account is linked to this Page yet.`,
            );
            await fetchStatus();
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Could not connect that Page.');
        } finally {
            setSavingPage(null);
        }
    }

    async function disconnectFacebook() {
        setError(null);
        try {
            await api.post('/channels/facebook/disconnect');
            setNotice('Facebook and Instagram disconnected.');
            await fetchStatus();
        } catch {
            setError('Could not disconnect.');
        }
    }

    const fbConnected = !!status?.messenger.connected;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Channels"
                subtitle="Where your customers can reach you. The assistant answers on every channel you connect."
            />

            {error && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}
            {notice && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                </div>
            )}

            {loading ? (
                <div className="flex items-center gap-3 py-10 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                    Checking your channels…
                </div>
            ) : (
                <div className="space-y-4">
                    {/* WhatsApp — owns its own setup screen, so this card links out. */}
                    <ChannelCard
                        icon={<MessageCircle className="w-5 h-5 text-[#25D366]" />}
                        name="WhatsApp"
                        blurb="Bookings, deposits and reminders. The only channel Meta charges for."
                        connected={!!status?.whatsapp.connected}
                        label={status?.whatsapp.label ?? null}
                        pending={status?.whatsapp.awaitingCode ? 'Waiting for your code' : null}
                        action={
                            <Link href="/whatsapp">
                                <Button variant="outline">
                                    {status?.whatsapp.connected ? 'Manage' : 'Set up'}
                                    <ArrowRight className="w-4 h-4" />
                                </Button>
                            </Link>
                        }
                    />

                    <ChannelCard
                        icon={<Instagram className="w-5 h-5 text-[#E1306C]" />}
                        name="Instagram"
                        blurb="Answers DMs and takes bookings. Free — Meta charges nothing for Instagram messages."
                        connected={!!status?.instagram.connected}
                        label={status?.instagram.label ?? null}
                        pending={fbConnected && !status?.instagram.connected
                            ? 'Page connected, but no Instagram account is linked to it'
                            : null}
                        action={
                            fbConnected ? null : (
                                <Button onClick={connectFacebook} disabled={connecting || !isOwner}>
                                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Facebook className="w-4 h-4" />}
                                    Connect
                                </Button>
                            )
                        }
                    />

                    <ChannelCard
                        icon={<Facebook className="w-5 h-5 text-[#1877F2]" />}
                        name="Facebook Messenger"
                        blurb="Answers messages to your Page. Free — Meta charges nothing for Messenger."
                        connected={fbConnected}
                        label={status?.messenger.label ?? null}
                        action={
                            fbConnected ? (
                                <Button variant="outline" onClick={disconnectFacebook} disabled={!isOwner}>
                                    Disconnect
                                </Button>
                            ) : (
                                <Button onClick={connectFacebook} disabled={connecting || !isOwner}>
                                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Facebook className="w-4 h-4" />}
                                    Connect
                                </Button>
                            )
                        }
                    />

                    {!isOwner && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Only the account owner can connect or disconnect channels.
                        </p>
                    )}

                    <Card>
                        <CardContent className="flex gap-3 text-sm text-slate-600 dark:text-slate-300">
                            <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                            <div className="space-y-1">
                                <p>
                                    Instagram and Messenger connect together, because Instagram messages
                                    are delivered through your Facebook Page. You will pick which Page to
                                    use.
                                </p>
                                <p className="text-slate-500 dark:text-slate-400">
                                    Reminders only go out on WhatsApp. On Instagram and Messenger, Meta
                                    does not allow messages once a customer has been quiet for 24 hours —
                                    so those bookings are reminded by SMS instead.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Page picker. Never auto-selected: a person may administer several
                Pages, and wiring the wrong one sends someone else's messages here. */}
            <Modal
                isOpen={!!pages}
                onClose={() => { setPages(null); setSelectionToken(null); }}
                title="Which Page is your business?"
            >
                <div className="space-y-2">
                    {(pages ?? []).map((p) => (
                        <button
                            key={p.pageId}
                            type="button"
                            onClick={() => choosePage(p.pageId)}
                            disabled={!!savingPage}
                            className="w-full text-left p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="font-medium text-slate-900 dark:text-white text-sm">{p.pageName}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        {p.hasInstagram
                                            ? `Instagram @${p.instagramUsername} will connect too`
                                            : 'No Instagram account linked to this Page'}
                                    </p>
                                </div>
                                {savingPage === p.pageId
                                    ? <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                                    : <ArrowRight className="w-4 h-4 text-slate-400" />}
                            </div>
                        </button>
                    ))}
                </div>
            </Modal>
        </div>
    );
}

interface ChannelCardProps {
    icon: React.ReactNode;
    name: string;
    blurb: string;
    connected: boolean;
    label: string | null;
    pending?: string | null;
    action: React.ReactNode;
}

function ChannelCard({ icon, name, blurb, connected, label, pending, action }: ChannelCardProps) {
    return (
        <Card>
            <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center shrink-0">
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-slate-900 dark:text-white text-sm">{name}</p>
                        {connected
                            ? <Badge variant="default" dot>Connected</Badge>
                            : <Badge variant="slate">Not connected</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {connected && label ? label : blurb}
                    </p>
                    {pending && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{pending}</p>
                    )}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </CardContent>
        </Card>
    );
}
