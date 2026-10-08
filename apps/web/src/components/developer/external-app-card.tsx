'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Unplug, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DashboardInput, Modal, Switch } from '@bookingflow/ui';
import { api } from '@/lib/api';
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
        onError: (err) => toast.error(errorText(err, 'Could not rotate the secret. Try again.')),
    });
    const disconnect = useMutation({
        mutationFn: async () => (await api.delete('/developer/external-app')).data,
        onSuccess: () => { toast.success('External app disconnected'); setDialog(null); refresh(); },
        onError: (err) => toast.error(errorText(err, 'Could not disconnect. Try again.')),
    });

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>
                    <Plug className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    External app
                </CardTitle>
                {app && <Badge variant={app.isActive ? 'default' : 'slate'}>{app.isActive ? 'Receiving events' : 'Paused'}</Badge>}
            </CardHeader>
            <CardContent>
                <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
                    {app ? (
                        <div className="space-y-4">
                            <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
                                <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                                <dd className="font-medium text-slate-900 dark:text-white">{app.name}</dd>
                                <dt className="text-slate-500 dark:text-slate-400">Webhook URL</dt>
                                <dd className="min-w-0 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{app.url}</dd>
                                <dt className="text-slate-500 dark:text-slate-400">Connected</dt>
                                <dd className="text-slate-700 dark:text-slate-300">{formatDate(app.createdAt)}</dd>
                            </dl>
                            <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => setDialog('edit')}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                                <Button size="sm" variant="outline" onClick={() => setDialog('rotate')}><RefreshCw className="h-3.5 w-3.5" /> Rotate signing secret</Button>
                                <Button size="sm" variant="destructive" onClick={() => setDialog('disconnect')}><Unplug className="h-3.5 w-3.5" /> Disconnect</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Connect your own system to receive signed webhooks when messages, bookings and payments happen.
                            </p>
                            <Button size="sm" onClick={() => setDialog('edit')}><Plug className="h-4 w-4" /> Connect an app</Button>
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

            <Modal isOpen={dialog === 'rotate'} onClose={() => setDialog(null)} title="Rotate the signing secret?">
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        Bookly starts signing webhooks with a new secret immediately and the current one stops working. Update your
                        app as soon as you have the new secret, or it will reject Bookly&apos;s webhooks until you do.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setDialog(null)} disabled={rotate.isPending}>Cancel</Button>
                        <Button onClick={() => rotate.mutate()} isLoading={rotate.isPending}>Rotate secret</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={dialog === 'disconnect'} onClose={() => setDialog(null)} title="Disconnect the external app?">
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        Bookly stops sending webhooks to <span className="break-all font-mono text-xs">{app?.url}</span>. Your API keys
                        are not affected. You can connect again later; you will get a new signing secret.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setDialog(null)} disabled={disconnect.isPending}>Cancel</Button>
                        <Button variant="destructive" onClick={() => disconnect.mutate()} isLoading={disconnect.isPending}>Disconnect</Button>
                    </div>
                </div>
            </Modal>

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

    useEffect(() => {
        if (isOpen) {
            setName(current?.name ?? '');
            setUrl(current?.url ?? '');
            setIsActive(current?.isActive ?? true);
        }
    }, [isOpen, current]);

    const save = useMutation({
        mutationFn: async () => (await api.put('/developer/external-app', { name: name.trim(), url: url.trim(), isActive })).data.data as ExternalApp & { signingSecret?: string },
        onSuccess: (d) => { toast.success(current ? 'External app updated' : 'External app connected'); onSaved(d.signingSecret); },
        onError: (err) => toast.error(errorText(err, 'Could not save. Check the URL and try again.')),
    });
    const valid = name.trim().length > 0 && name.trim().length <= 80 && /^https?:\/\//i.test(url.trim());

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={current ? 'Edit external app' : 'Connect an external app'} maxWidth="max-w-lg">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
                <DashboardInput label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. TURBO back office" />
                <DashboardInput label="Webhook URL" type="url" value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/bookly" />
                <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-700 dark:text-slate-300">Send events to this app</span>
                    <Switch checked={isActive} onChange={setIsActive} label="Send events to this app" />
                </div>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
                    <Button type="submit" disabled={!valid} isLoading={save.isPending}>{current ? 'Save' : 'Connect'}</Button>
                </div>
            </form>
        </Modal>
    );
}
