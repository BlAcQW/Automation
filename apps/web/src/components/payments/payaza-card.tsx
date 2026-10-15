'use client';

/**
 * Settings → Payments: the provider choice (Paystack / Payaza) and the Payaza
 * connection card. Talks to /payments/status, /payments/provider and
 * /payments/payaza/{connect,disconnect}. Secrets are write-only: the API never
 * returns them, and the form clears them after a connect.
 */
import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, Copy, Wallet, FlaskConical } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, DashboardInput } from '@bookingflow/ui';
import { api } from '@/lib/api';

export type PaymentProvider = 'PAYSTACK' | 'PAYAZA';
export type PayazaMode = 'TEST' | 'LIVE';

export interface PayazaStatus {
    connected: boolean;
    mode: PayazaMode;
    publicKeyPrefix: string | null;
    webhookUrl: string;
}

function errorMessage(err: unknown, fallback: string): string {
    const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return typeof msg === 'string' && msg ? msg : fallback;
}

const segment = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50 ${
        active
            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-medium'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
    }`;

// ------------------------------------------------------------ provider choice

interface ProviderChoiceProps {
    provider: PaymentProvider;
    payazaConnected: boolean;
    canEdit: boolean;
    onChanged: () => Promise<void> | void;
}

export function PaymentProviderChoice({ provider, payazaConnected, canEdit, onChanged }: ProviderChoiceProps) {
    const [saving, setSaving] = useState(false);

    const choose = async (next: PaymentProvider) => {
        if (next === provider) return;
        if (next === 'PAYAZA' && !payazaConnected) {
            toast.error('Connect Payaza below first.');
            return;
        }
        setSaving(true);
        try {
            await api.patch('/payments/provider', { provider: next });
            toast.success(next === 'PAYAZA' ? 'New payment links now use Payaza' : 'New payment links now use Paystack');
            await onChanged();
        } catch (err) {
            toast.error(errorMessage(err, 'Could not change the payment provider'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">Payment provider</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Used for ride and flow payment links. Bookings and orders always use Paystack.
                    </p>
                </div>
                <div role="radiogroup" aria-label="Payment provider" className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
                    {(['PAYSTACK', 'PAYAZA'] as const).map((p) => (
                        <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={provider === p}
                            disabled={!canEdit || saving}
                            onClick={() => choose(p)}
                            className={segment(provider === p)}
                        >
                            {p === 'PAYSTACK' ? 'Paystack' : 'Payaza'}
                        </button>
                    ))}
                </div>
            </div>
            {!canEdit && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Only the owner can change the payment provider.</p>
            )}
        </div>
    );
}

// ------------------------------------------------------------ webhook URL

function WebhookUrlBox({ url }: { url: string }) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Payaza webhook URL</p>
            <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-xs bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 rounded-lg px-3 py-2">
                    {url}
                </code>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        navigator.clipboard.writeText(url)
                            .then(() => toast.success('Webhook URL copied'))
                            .catch(() => toast.error('Could not copy. Select it manually.'));
                    }}
                >
                    <Copy className="w-4 h-4 mr-1.5" />
                    Copy
                </Button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                In your Payaza dashboard go to Settings → Developers → Webhooks and paste this URL for
                collections (Live and Test). Payments confirm only through this webhook.
            </p>
        </div>
    );
}

// ------------------------------------------------------------ Payaza card

interface PayazaCardProps {
    status: PayazaStatus | null;
    selected: boolean;
    canEdit: boolean;
    onChanged: () => Promise<void> | void;
}

export function PayazaCard({ status, selected, canEdit, onChanged }: PayazaCardProps) {
    const [publicKey, setPublicKey] = useState('');
    const [secretKey, setSecretKey] = useState('');
    const [mode, setMode] = useState<PayazaMode>('TEST');
    const [submitting, setSubmitting] = useState(false);

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/payments/payaza/connect', { publicKey: publicKey.trim(), secretKey: secretKey.trim(), mode });
            toast.success(`Payaza connected (${mode === 'LIVE' ? 'Live' : 'Test'})`);
            setPublicKey('');
            setSecretKey('');
            await onChanged();
        } catch (err) {
            toast.error(errorMessage(err, 'Connect failed'));
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        const pending = 'Payments customers are still making on Payaza links will no longer confirm automatically.';
        const warning = selected
            ? `Disconnect Payaza? New ride payment links will go back to Paystack. ${pending}`
            : `Disconnect Payaza? ${pending}`;
        if (!confirm(warning)) return;
        try {
            await api.post('/payments/payaza/disconnect');
            toast.success('Payaza disconnected');
            await onChanged();
        } catch (err) {
            toast.error(errorMessage(err, 'Disconnect failed'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    Payaza
                    {selected && <Badge variant="default" className="ml-2">In use</Badge>}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {status?.connected ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-700/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                    <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <p className="font-medium text-emerald-900 dark:text-emerald-200 text-sm flex items-center gap-2">
                                        Payaza connected
                                        <Badge variant={status.mode === 'LIVE' ? 'default' : 'yellow'}>
                                            {status.mode === 'LIVE' ? 'Live' : 'Test'}
                                        </Badge>
                                    </p>
                                    {status.publicKeyPrefix && (
                                        <p className="text-emerald-700 dark:text-emerald-300 text-xs">
                                            public key <span className="font-mono">{status.publicKeyPrefix}…</span>
                                        </p>
                                    )}
                                </div>
                            </div>
                            {canEdit && (
                                <Button variant="destructive" size="sm" onClick={disconnect}>
                                    Disconnect
                                </Button>
                            )}
                        </div>
                        {status.mode === 'TEST' && (
                            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                                <FlaskConical className="w-4 h-4 shrink-0" />
                                Test mode: payments are not real money. Reconnect with your Live keys before taking real payments.
                            </p>
                        )}
                        <WebhookUrlBox url={status.webhookUrl} />
                    </div>
                ) : canEdit ? (
                    <form onSubmit={connect} className="space-y-4">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Paste your keys from the Payaza dashboard (Settings → Developers). Both keys are
                            encrypted at rest; the secret key only checks that payment notifications really come from Payaza.
                        </p>
                        <div className="space-y-1.5">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Mode</span>
                            <div role="radiogroup" aria-label="Payaza mode" className="flex w-fit rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
                                {(['TEST', 'LIVE'] as const).map((m) => (
                                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={segment(mode === m)}>
                                        {m === 'TEST' ? 'Test' : 'Live'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <DashboardInput
                            label="Public Key"
                            placeholder={mode === 'LIVE' ? 'PZ78-PKLIVE-...' : 'PZ78-PKTEST-...'}
                            value={publicKey}
                            onChange={(e) => setPublicKey(e.target.value)}
                            autoComplete="off"
                            required
                        />
                        <DashboardInput
                            label="Secret Key"
                            type="password"
                            placeholder={mode === 'LIVE' ? 'PZ78-SKLIVE-...' : 'PZ78-SKTEST-...'}
                            value={secretKey}
                            onChange={(e) => setSecretKey(e.target.value)}
                            autoComplete="off"
                            required
                        />
                        <Button type="submit" disabled={submitting || !publicKey || !secretKey}>
                            {submitting ? 'Connecting…' : 'Connect Payaza'}
                        </Button>
                        {status && <WebhookUrlBox url={status.webhookUrl} />}
                    </form>
                ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Payaza is not connected. Ask the owner to connect it.</p>
                )}
            </CardContent>
        </Card>
    );
}
