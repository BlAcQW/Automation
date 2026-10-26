'use client';

/** Settings → backup channels: SMS (Arkesel) and email (Gmail SMTP) when WhatsApp can't deliver. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Info } from 'lucide-react';
import { Button, DashboardInput, ConfirmDialog, SkeletonCard } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { ConnectionRow } from '@/components/payments/connection-parts';
import { SettingsCard } from './settings-card';

function Loading() {
    return (
        <div aria-busy="true">
            <span className="sr-only">Loading…</span>
            <SkeletonCard />
        </div>
    );
}

const linkCls = 'font-semibold text-primary underline underline-offset-2';

// ============================================================================
// SMS backup (Arkesel)
// ============================================================================

interface SmsStatus {
    connected: boolean;
    senderId: string | null;
    balance: number | null;
}

export function SmsFallbackCard() {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['sms', 'status'],
        queryFn: async () => (await api.get('/sms/status')).data as SmsStatus,
    });
    const [apiKey, setApiKey] = useState('');
    const [senderId, setSenderId] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/sms/connect', { apiKey: apiKey.trim(), senderId: senderId.trim() });
            notify.success('SMS backup connected');
            setApiKey('');
            setSenderId('');
            await queryClient.invalidateQueries({ queryKey: ['sms', 'status'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't connect Arkesel. Check the key and try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        setDisconnecting(true);
        try {
            await api.post('/sms/disconnect');
            notify.success('SMS backup disconnected');
            setConfirmOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['sms', 'status'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't disconnect. Let's try again.");
        } finally {
            setDisconnecting(false);
        }
    };

    return (
        <SettingsCard
            icon={<Send />}
            title="SMS backup"
            description="If a WhatsApp message can't be delivered, we send it by SMS through Arkesel."
        >
            {isLoading ? (
                <Loading />
            ) : data?.connected ? (
                <>
                    <ConnectionRow
                        connected
                        name="Arkesel SMS"
                        icon={<Send />}
                        detail={
                            <>
                                Sender name <span className="font-mono">{data.senderId}</span>
                                {data.balance != null && <> · balance <span className="font-mono">{data.balance}</span></>}
                            </>
                        }
                        action={
                            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
                                Disconnect
                            </Button>
                        }
                    />
                    <p className="text-[14px] text-muted">One SMS counts as one message toward your monthly limit.</p>
                </>
            ) : (
                <form onSubmit={connect} className="space-y-4">
                    <ConnectionRow connected={false} name="Arkesel SMS" icon={<Send />} detail="Not set up yet." />
                    <p className="text-[15px] leading-relaxed text-muted">
                        Copy your API key from{' '}
                        <a href="https://account.arkesel.com" target="_blank" rel="noreferrer" className={linkCls}>
                            account.arkesel.com → Developer
                        </a>
                        . We store it encrypted.
                    </p>
                    <DashboardInput
                        label="API key"
                        type="password"
                        placeholder="ArkeselApiKey..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        required
                    />
                    <DashboardInput
                        label="Sender name"
                        hint="What customers see as the sender. Up to 11 letters or numbers."
                        placeholder="Bookly"
                        value={senderId}
                        onChange={(e) => setSenderId(e.target.value)}
                        required
                        maxLength={11}
                    />
                    <Button type="submit" disabled={!apiKey || !senderId} isLoading={submitting} loadingText="Connecting…">
                        Connect Arkesel
                    </Button>
                </form>
            )}
            <ConfirmDialog
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                isLoading={disconnecting}
                title="Turn off SMS backup?"
                description="Messages that fail on WhatsApp will no longer be sent by SMS."
                confirmLabel="Disconnect"
                cancelLabel="Keep it on"
            />
        </SettingsCard>
    );
}

// ============================================================================
// Email backup (Gmail SMTP)
// ============================================================================

interface EmailStatus {
    connected: boolean;
    user: string | null;
    fromName: string | null;
}

export function EmailFallbackCard() {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['email', 'status'],
        queryFn: async () => (await api.get('/email/status')).data as EmailStatus,
    });
    const [user, setUser] = useState('');
    const [appPassword, setAppPassword] = useState('');
    const [fromName, setFromName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/email/connect', {
                user: user.trim(),
                appPassword: appPassword.trim(),
                fromName: fromName.trim() || undefined,
            });
            notify.success('Email backup connected');
            setUser('');
            setAppPassword('');
            setFromName('');
            await queryClient.invalidateQueries({ queryKey: ['email', 'status'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't connect Gmail. Check the app password and try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        setDisconnecting(true);
        try {
            await api.post('/email/disconnect');
            notify.success('Email backup disconnected');
            setConfirmOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['email', 'status'] });
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't disconnect. Let's try again.");
        } finally {
            setDisconnecting(false);
        }
    };

    return (
        <SettingsCard
            icon={<Mail />}
            title="Email backup"
            description="If WhatsApp and SMS both fail, we email the customer instead."
        >
            {isLoading ? (
                <Loading />
            ) : data?.connected ? (
                <>
                    <ConnectionRow
                        connected
                        name="Your Gmail"
                        icon={<Mail />}
                        detail={
                            <>
                                <span className="font-mono">{data.user}</span>
                                {data.fromName && <> · from “{data.fromName}”</>}
                            </>
                        }
                        action={
                            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
                                Disconnect
                            </Button>
                        }
                    />
                    <p className="text-[14px] leading-relaxed text-muted">
                        Emails only go out when the booking or order has the customer&apos;s email address. For now your
                        team can add it by hand in the dashboard.
                    </p>
                </>
            ) : (
                <form onSubmit={connect} className="space-y-4">
                    <div className="flex items-start gap-2.5 rounded-control bg-surface-2 p-3.5 text-[15px] leading-relaxed text-text">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                        <p>
                            This is already on: backup emails go out from Bookly&apos;s shared address. Connect your own
                            Gmail to send them in your business&apos;s name instead.
                        </p>
                    </div>
                    <p className="text-[15px] leading-relaxed text-muted">
                        Make a 16-character app password at{' '}
                        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className={linkCls}>
                            myaccount.google.com/apppasswords
                        </a>
                        . Your normal Gmail password won&apos;t work here.
                    </p>
                    <DashboardInput
                        label="Gmail address"
                        type="email"
                        placeholder="you@gmail.com"
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        required
                    />
                    <DashboardInput
                        label="App password"
                        hint="16 characters, from the Google page above."
                        type="password"
                        placeholder="xxxx xxxx xxxx xxxx"
                        value={appPassword}
                        onChange={(e) => setAppPassword(e.target.value)}
                        required
                    />
                    <DashboardInput
                        label="From name (optional)"
                        placeholder="Bookly"
                        value={fromName}
                        onChange={(e) => setFromName(e.target.value)}
                    />
                    <Button type="submit" disabled={!user || !appPassword} isLoading={submitting} loadingText="Checking…">
                        Connect Gmail
                    </Button>
                </form>
            )}
            <ConfirmDialog
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                isLoading={disconnecting}
                title="Disconnect your Gmail?"
                description="Messages that fail on WhatsApp and SMS will no longer be emailed from your address."
                confirmLabel="Disconnect"
                cancelLabel="Keep connected"
            />
        </SettingsCard>
    );
}
