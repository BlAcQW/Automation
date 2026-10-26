'use client';

/**
 * Settings → Payments: the provider choice (Paystack / Payaza) and the Payaza
 * connection card. Talks to /payments/status, /payments/provider and
 * /payments/payaza/{connect,disconnect}. Secrets are write-only: the API never
 * returns them, and the form clears them after a connect.
 */
import { useState } from 'react';
import { Wallet, FlaskConical } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, DashboardInput, ConfirmDialog } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { ConnectionRow, CopyField, Segmented } from './connection-parts';

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

const PROVIDERS = [
    { value: 'PAYSTACK', label: 'Paystack' },
    { value: 'PAYAZA', label: 'Payaza' },
] as const;

const MODES = [
    { value: 'TEST', label: 'Test' },
    { value: 'LIVE', label: 'Live' },
] as const;

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
            notify.error('Connect Payaza below first.');
            return;
        }
        setSaving(true);
        try {
            await api.patch('/payments/provider', { provider: next });
            notify.success(next === 'PAYAZA' ? 'New payment links now use Payaza' : 'New payment links now use Paystack');
            await onChanged();
        } catch (err) {
            notify.error(errorMessage(err, "Couldn't change how you get paid. Let's try again."));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3 rounded-control border border-border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="text-base font-semibold text-text">Which provider sends payment links?</p>
                    <p className="text-[14px] text-muted">
                        Used for ride and flow payment links. Bookings and orders always use Paystack.
                    </p>
                </div>
                <Segmented
                    label="Payment provider"
                    options={PROVIDERS}
                    value={provider}
                    onChange={choose}
                    disabled={!canEdit || saving}
                />
            </div>
            {!canEdit && <p className="text-[14px] text-muted">Only the owner can change this.</p>}
        </div>
    );
}

// ------------------------------------------------------------ webhook URL

function WebhookUrlBox({ url }: { url: string }) {
    return (
        <CopyField
            label="Payaza webhook link"
            value={url}
            copiedMessage="Webhook link copied"
            hint={
                <>
                    In your Payaza dashboard go to Settings → Developers → Webhooks and paste this link for
                    collections (Live and Test). Payments only confirm through this link.
                </>
            }
        />
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
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/payments/payaza/connect', { publicKey: publicKey.trim(), secretKey: secretKey.trim(), mode });
            notify.success(`Payaza connected (${mode === 'LIVE' ? 'Live' : 'Test'})`);
            setPublicKey('');
            setSecretKey('');
            await onChanged();
        } catch (err) {
            notify.error(errorMessage(err, "Couldn't connect Payaza. Check both keys and try again."));
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        setDisconnecting(true);
        try {
            await api.post('/payments/payaza/disconnect');
            notify.success('Payaza disconnected');
            setConfirmOpen(false);
            await onChanged();
        } catch (err) {
            notify.error(errorMessage(err, "Couldn't disconnect Payaza. Let's try again."));
        } finally {
            setDisconnecting(false);
        }
    };

    const pending = 'Payments customers are still making on Payaza links will no longer confirm automatically.';

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Wallet className="h-5 w-5 text-primary" aria-hidden />
                    Payaza
                    {selected && <Badge variant="success" className="ml-1">In use</Badge>}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {status?.connected ? (
                    <div className="space-y-4">
                        <ConnectionRow
                            connected
                            name="Payaza"
                            icon={<Wallet />}
                            extra={
                                <Badge variant={status.mode === 'LIVE' ? 'success' : 'warning'}>
                                    {status.mode === 'LIVE' ? 'Live' : 'Test'}
                                </Badge>
                            }
                            detail={
                                status.publicKeyPrefix && (
                                    <>Public key <span className="font-mono">{status.publicKeyPrefix}…</span></>
                                )
                            }
                            action={
                                canEdit && (
                                    <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
                                        Disconnect
                                    </Button>
                                )
                            }
                        />
                        {status.mode === 'TEST' && (
                            <p className="flex items-start gap-2 rounded-control bg-warning-soft p-3 text-[14px] text-warning-fg">
                                <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                Test mode: these payments are not real money. Reconnect with your Live keys before you take real payments.
                            </p>
                        )}
                        <WebhookUrlBox url={status.webhookUrl} />
                    </div>
                ) : canEdit ? (
                    <form onSubmit={connect} className="space-y-4">
                        <ConnectionRow
                            connected={false}
                            name="Payaza"
                            icon={<Wallet />}
                            detail="Take mobile money and card payments through Payaza."
                        />
                        <p className="text-[15px] leading-relaxed text-muted">
                            Paste your keys from the Payaza dashboard (Settings → Developers). Both keys are stored
                            encrypted. The secret key only checks that payment notices really come from Payaza.
                        </p>
                        <div className="space-y-1.5">
                            <span className="text-small font-medium text-text">Mode</span>
                            <div>
                                <Segmented label="Payaza mode" options={MODES} value={mode} onChange={setMode} />
                            </div>
                        </div>
                        <DashboardInput
                            label="Public key"
                            placeholder={mode === 'LIVE' ? 'PZ78-PKLIVE-...' : 'PZ78-PKTEST-...'}
                            value={publicKey}
                            onChange={(e) => setPublicKey(e.target.value)}
                            autoComplete="off"
                            required
                        />
                        <DashboardInput
                            label="Secret key"
                            type="password"
                            placeholder={mode === 'LIVE' ? 'PZ78-SKLIVE-...' : 'PZ78-SKTEST-...'}
                            value={secretKey}
                            onChange={(e) => setSecretKey(e.target.value)}
                            autoComplete="off"
                            required
                        />
                        <Button type="submit" disabled={!publicKey || !secretKey} isLoading={submitting} loadingText="Connecting…">
                            Connect Payaza
                        </Button>
                        {status && <WebhookUrlBox url={status.webhookUrl} />}
                    </form>
                ) : (
                    <ConnectionRow
                        connected={false}
                        name="Payaza"
                        icon={<Wallet />}
                        detail="Ask the owner of this business to connect it."
                    />
                )}
            </CardContent>
            <ConfirmDialog
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                isLoading={disconnecting}
                title="Disconnect Payaza?"
                description={selected ? `New ride payment links will go back to Paystack. ${pending}` : pending}
                confirmLabel="Disconnect"
                cancelLabel="Keep connected"
            />
        </Card>
    );
}
