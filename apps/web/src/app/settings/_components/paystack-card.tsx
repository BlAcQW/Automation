'use client';

/** Settings → Getting paid: provider choice + Paystack keys. State lives in the page (shared with Payaza). */
import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button, DashboardInput, Select, ConfirmDialog } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { PaymentProviderChoice, type PaymentProvider, type PayazaStatus } from '@/components/payments/payaza-card';
import { ConnectionRow, CopyField } from '@/components/payments/connection-parts';
import { SettingsCard } from './settings-card';

export const SUPPORTED_CURRENCIES = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_LABEL: Record<SupportedCurrency, string> = {
    GHS: 'Ghana cedi (GH₵)',
    NGN: 'Nigerian naira (NGN)',
    ZAR: 'South African rand (ZAR)',
    KES: 'Kenyan shilling (KES)',
    USD: 'US dollar (USD)',
};

export interface PaymentsStatus {
    /** Paystack. */
    connected: boolean;
    publicKey: string | null;
    currency: string;
    /** Which gateway new ride / flow payment links use. Absent on an older API. */
    provider?: PaymentProvider;
    payaza?: PayazaStatus;
}

interface PaystackCardProps {
    status: PaymentsStatus | null;
    canEdit: boolean;
    initialCurrency: SupportedCurrency;
    onChanged: () => Promise<void>;
}

export function PaystackCard({ status, canEdit, initialCurrency, onChanged }: PaystackCardProps) {
    const [secret, setSecret] = useState('');
    const [publicKey, setPublicKey] = useState('');
    const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);
    const [submitting, setSubmitting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    // The status loads after mount: follow the saved currency once it arrives.
    useEffect(() => setCurrency(initialCurrency), [initialCurrency]);

    // The Paystack webhook URL the tenant must register in their dashboard.
    const webhookUrl = `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}/payments/webhook`;

    const connect = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/payments/connect', {
                publicKey: publicKey.trim(),
                secretKey: secret.trim(),
                currency,
            });
            notify.success('Paystack connected');
            setSecret('');
            setPublicKey('');
            await onChanged();
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't connect Paystack. Check both keys and try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const disconnect = async () => {
        setDisconnecting(true);
        try {
            await api.post('/payments/disconnect');
            notify.success('Paystack disconnected');
            setConfirmOpen(false);
            await onChanged();
        } catch (err: any) {
            notify.error(err?.response?.data?.message ?? "Couldn't disconnect Paystack. Let's try again.");
        } finally {
            setDisconnecting(false);
        }
    };

    return (
        <SettingsCard
            icon={<CreditCard />}
            title="Paystack"
            description="Send customers a payment link for deposits and orders. They pay by mobile money or card."
        >
            {status?.payaza && (
                <PaymentProviderChoice
                    provider={status.provider ?? 'PAYSTACK'}
                    payazaConnected={status.payaza.connected}
                    canEdit={canEdit}
                    onChanged={onChanged}
                />
            )}
            {status?.connected ? (
                <>
                    <ConnectionRow
                        connected
                        name="Paystack"
                        icon={<CreditCard />}
                        detail={
                            <>
                                Charging in <span className="font-semibold text-text">{status.currency}</span>
                                {status.publicKey && (
                                    <> · public key <span className="font-mono">{status.publicKey.slice(0, 16)}…</span></>
                                )}
                            </>
                        }
                        action={
                            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
                                Disconnect
                            </Button>
                        }
                    />
                    <CopyField
                        label="Webhook link"
                        value={webhookUrl}
                        copiedMessage="Webhook link copied"
                        hint={
                            <>
                                Paste this into Paystack: Settings → API Keys &amp; Webhooks → Webhook URL. Then payments
                                confirm the moment they happen. Without it they still confirm, just a little later.
                            </>
                        }
                    />
                </>
            ) : (
                <form onSubmit={connect} className="space-y-4">
                    <ConnectionRow connected={false} name="Paystack" icon={<CreditCard />} detail="Not connected yet." />
                    <p className="text-[15px] leading-relaxed text-muted">
                        Copy your keys from{' '}
                        <a
                            href="https://dashboard.paystack.com/#/settings/developer"
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-primary underline underline-offset-2"
                        >
                            Paystack → Settings → API Keys
                        </a>
                        . We store your secret key encrypted.
                    </p>
                    <DashboardInput
                        label="Public key"
                        placeholder="pk_test_..."
                        value={publicKey}
                        onChange={(e) => setPublicKey(e.target.value)}
                        required
                    />
                    <DashboardInput
                        label="Secret key"
                        type="password"
                        placeholder="sk_test_..."
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        required
                    />
                    <Select
                        label="Currency"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
                    >
                        {SUPPORTED_CURRENCIES.map((c) => (
                            <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>
                        ))}
                    </Select>
                    <Button type="submit" disabled={!publicKey || !secret} isLoading={submitting} loadingText="Connecting…">
                        Connect Paystack
                    </Button>
                </form>
            )}
            <ConfirmDialog
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={disconnect}
                isLoading={disconnecting}
                title="Disconnect Paystack?"
                description="Customers will stop getting payment links on new orders."
                confirmLabel="Disconnect"
                cancelLabel="Keep connected"
            />
        </SettingsCard>
    );
}
