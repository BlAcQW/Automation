'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Unplug, Pencil } from 'lucide-react';
import {
    Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, DashboardInput, Modal, StatusPill, Switch,
} from '@bookingflow/ui';
import { api } from '@/lib/api';
import { notify } from '@/components/brand/toast';
import { QueryState } from '@/components/query-state';
import { SecretReveal } from './secret-reveal';
import { errorText, formatDate, type ExternalApp } from './types';

const APP_QUERY = ['developer', 'external-app'] as const;

const SECRET_NOTE = (
    <p>
        Every webhook Bookly sends to your app is signed with this secret. Use it to check the signature before trusting a
        request. The previous secret has stopped working.
    </p>
);

type Dialog = 'edit' | 'rotate' | 'disconnect' | null;

/**
 * The external app (D2): where Bookly sends signed webhooks. Shown only to the
 * owner (the page gates it). The signing secret is shown once: on first
 * connect and on rotation.
 */
export function ExternalAppCard() {
    const queryClient = useQueryClient();
    const [dialog, setDialog] = useState<Dialog>(null);
    const [secret, setSecret] = useState<string | null>(null);

    const { data: app, isLoading, isError, refetch } = useQuery({
        queryKey: APP_QUERY,
        queryFn: async () => (await api.get('/developer/external-app')).data.data as ExternalApp | null,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: APP_QUERY });

    const rotate = useMutation({
        mutationFn: async () => (await api.post('/developer/external-app/rotate-secret')).data.data as { signingSecret: string },
        onSuccess: (d) => { setSecret(d.signingSecret); setDialog(null); },
        onError: (err) => notify.error(errorText(err, "Couldn't change the secret. Let's try again.")),
    });
    const disconnect = useMutation({
        mutationFn: async () => (await api.delete('/developer/external-app')).data,
        onSuccess: () => { notify.success('App disconnected'); setDialog(null); refresh(); },
        onError: (err) => notify.error(errorText(err, "Couldn't disconnect. Let's try again.")),
    });

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>
                    <Plug className="h-5 w-5 text-primary" aria-hidden />
                    Your app (webhooks)
                </CardTitle>
                {app ? (
                    <StatusPill
                        status={app.isActive ? 'active' : 'inactive'}
                        label={app.isActive ? 'Receiving events' : 'Paused'}
                    />
                ) : (
                    !isLoading && !isError && <StatusPill status="inactive" label="Not connected" />
                )}
            </CardHeader>
            <CardContent>
                <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
                    {app ? (
                        <div className="space-y-5">
                            <dl className="grid gap-x-4 gap-y-1 text-[15px] sm:grid-cols-[9rem_1fr] sm:gap-y-3">
                                <dt className="text-muted">Name</dt>
                                <dd className="mb-2 font-semibold text-text sm:mb-0">{app.name}</dd>
                                <dt className="text-muted">Webhook link</dt>
                                <dd className="mb-2 min-w-0 break-all font-mono text-[13px] text-text sm:mb-0">{app.url}</dd>
                                <dt className="text-muted">Connected</dt>
                                <dd className="text-text">{formatDate(app.createdAt)}</dd>
                            </dl>
                            <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>
                                    <Pencil className="h-4 w-4" aria-hidden /> Edit
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setDialog('rotate')}>
                                    <RefreshCw className="h-4 w-4" aria-hidden /> New signing secret
                                </Button>
                                <Button size="sm" variant="ghost" className="text-error-fg" onClick={() => setDialog('disconnect')}>
                                    <Unplug className="h-4 w-4" aria-hidden /> Disconnect
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-[15px] leading-relaxed text-muted">
                                Connect your own system and Bookly will tell it, with signed webhooks, when messages,
                                bookings and payments happen.
                            </p>
                            <Button onClick={() => setDialog('edit')}>
                                <Plug className="h-4 w-4" aria-hidden /> Connect an app
                            </Button>
                        </div>
                    )}
                </QueryState>
            </CardContent>

            <EditAppDialog
                isOpen={dialog === 'edit'}
                current={app ?? null}
                onClose={() => setDialog(null)}
                onSaved={(s) => { setDialog(null); refresh(); if (s) setSecret(s); }}
            />

            <ConfirmDialog
                isOpen={dialog === 'rotate'}
                onClose={() => setDialog(null)}
                onConfirm={() => rotate.mutate()}
                isLoading={rotate.isPending}
                destructive={false}
                title="Make a new signing secret?"
                description="Bookly starts signing webhooks with the new secret straight away and the current one stops working. Update your app as soon as you have it, or it will reject Bookly's webhooks until you do."
                confirmLabel="Make new secret"
                cancelLabel="Not now"
            />

            <ConfirmDialog
                isOpen={dialog === 'disconnect'}
                onClose={() => setDialog(null)}
                onConfirm={() => disconnect.mutate()}
                isLoading={disconnect.isPending}
                title="Disconnect your app?"
                description={
                    <>
                        Bookly stops sending webhooks to <span className="break-all font-mono text-[13px]">{app?.url}</span>.
                        Your API keys keep working. You can connect again later and get a new signing secret.
                    </>
                }
                confirmLabel="Disconnect"
                cancelLabel="Keep connected"
            />

            <Modal isOpen={secret !== null} onClose={() => setSecret(null)} title="Your signing secret" maxWidth="max-w-lg">
                {secret && <SecretReveal label="Signing secret" secret={secret} note={SECRET_NOTE} onDone={() => setSecret(null)} />}
            </Modal>
        </Card>
    );
}

function EditAppDialog({ isOpen, current, onClose, onSaved }: {
    isOpen: boolean;
    current: ExternalApp | null;
    onClose: () => void;
    /** Called with the signing secret when the app was just created (shown once). */
    onSaved: (signingSecret?: string) => void;
}) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [isActive, setIsActive] = useState(true);
    const [touchedUrl, setTouchedUrl] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setName(current?.name ?? '');
            setUrl(current?.url ?? '');
            setIsActive(current?.isActive ?? true);
            setTouchedUrl(false);
        }
    }, [isOpen, current]);

    const save = useMutation({
        mutationFn: async () => (await api.put('/developer/external-app', { name: name.trim(), url: url.trim(), isActive })).data.data as ExternalApp & { signingSecret?: string },
        onSuccess: (d) => { notify.success(current ? 'App updated' : 'App connected'); onSaved(d.signingSecret); },
        onError: (err) => notify.error(errorText(err, "Couldn't save. Check the link and try again.")),
    });
    const urlOk = /^https?:\/\//i.test(url.trim());
    const valid = name.trim().length > 0 && name.trim().length <= 80 && urlOk;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={current ? 'Edit your app' : 'Connect an app'} maxWidth="max-w-lg">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
                <DashboardInput label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. TURBO back office" />
                <DashboardInput
                    label="Webhook link"
                    type="url"
                    value={url}
                    maxLength={2000}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => setTouchedUrl(true)}
                    placeholder="https://example.com/webhooks/bookly"
                    error={touchedUrl && url.trim() && !urlOk ? 'Start the link with https://' : undefined}
                />
                <div className="flex items-center justify-between gap-4">
                    <span className="text-[15px] text-text">Send events to this app</span>
                    <Switch checked={isActive} onChange={setIsActive} label="Send events to this app" />
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
                    <Button type="submit" disabled={!valid} isLoading={save.isPending}>{current ? 'Save' : 'Connect'}</Button>
                </div>
            </form>
        </Modal>
    );
}
