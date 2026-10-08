'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, DashboardInput, Modal, cn } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { SecretReveal } from './secret-reveal';
import { DEFAULT_GRACE_HOURS, GRACE_OPTIONS, errorText, maskedPrefix, timeUntil, type ApiKey, type ScopeInfo } from './types';

const KEY_NOTE = (
    <p>
        Send it as <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">Authorization: Bearer &lt;key&gt;</code>.
        Keep it on your server; never put it in a website or mobile app.
    </p>
);

// ---------------------------------------------------------------------------
// Create

interface CreateKeyDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onChanged: () => void;
}

export function CreateKeyDialog({ isOpen, onClose, onChanged }: CreateKeyDialogProps) {
    const [name, setName] = useState('');
    const [scopes, setScopes] = useState<string[]>([]);
    const [created, setCreated] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) { setName(''); setScopes([]); setCreated(null); }
    }, [isOpen]);

    const scopesQuery = useQuery({
        queryKey: ['developer', 'scopes'],
        queryFn: async () => (await api.get('/developer/scopes')).data.data as ScopeInfo[],
        enabled: isOpen,
        staleTime: 60 * 60_000,
    });

    const create = useMutation({
        mutationFn: async () => (await api.post('/developer/api-keys', { name: name.trim(), scopes })).data.data as { key: string; apiKey: ApiKey },
        onSuccess: (d) => { setCreated(d.key); onChanged(); },
        onError: (err) => toast.error(errorText(err, 'Could not create the key. Try again.')),
    });

    const toggle = (scope: string) =>
        setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
    const valid = name.trim().length > 0 && name.trim().length <= 60 && scopes.length > 0;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={created ? 'Your new API key' : 'Create an API key'} maxWidth="max-w-lg">
            {created ? (
                <SecretReveal label="API key" secret={created} note={KEY_NOTE} onDone={onClose} />
            ) : (
                <form
                    className="space-y-5"
                    onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}
                >
                    <DashboardInput
                        label="Name"
                        placeholder="e.g. Booking site (production)"
                        value={name}
                        maxLength={60}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                    />
                    <fieldset className="space-y-2">
                        <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">What can this key do?</legend>
                        <ScopePicker query={scopesQuery} selected={scopes} onToggle={toggle} />
                    </fieldset>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Cancel</Button>
                        <Button type="submit" disabled={!valid} isLoading={create.isPending}>Create key</Button>
                    </div>
                </form>
            )}
        </Modal>
    );
}

function ScopePicker({ query, selected, onToggle }: {
    query: { data?: ScopeInfo[]; isLoading: boolean; isError: boolean; refetch: () => unknown };
    selected: string[];
    onToggle: (scope: string) => void;
}) {
    if (query.isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
    if (query.isError || !query.data) {
        return (
            <p className="text-sm text-rose-500">
                Could not load the permissions.{' '}
                <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button>
            </p>
        );
    }
    return (
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700">
            {query.data.map((s) => {
                const on = selected.includes(s.scope);
                return (
                    <label
                        key={s.scope}
                        className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors',
                            on ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                        )}
                    >
                        <input
                            type="checkbox"
                            checked={on}
                            onChange={() => onToggle(s.scope)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="min-w-0">
                            <span className="block font-mono text-xs font-medium text-slate-900 dark:text-white">{s.scope}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">{s.description}</span>
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Rotate

interface KeyDialogProps {
    apiKey: ApiKey | null;
    onClose: () => void;
    onChanged: () => void;
}

export function RotateKeyDialog({ apiKey, onClose, onChanged }: KeyDialogProps) {
    const [graceHours, setGraceHours] = useState<number>(DEFAULT_GRACE_HOURS);
    const [created, setCreated] = useState<string | null>(null);
    const isOpen = apiKey !== null;

    useEffect(() => {
        if (!isOpen) { setGraceHours(DEFAULT_GRACE_HOURS); setCreated(null); }
    }, [isOpen]);

    const rotate = useMutation({
        mutationFn: async () => (await api.post(`/developer/api-keys/${apiKey!.id}/rotate`, { graceHours })).data.data as { key: string },
        onSuccess: (d) => { setCreated(d.key); onChanged(); },
        onError: (err) => toast.error(errorText(err, 'Could not rotate the key. Try again.')),
    });

    const choice = GRACE_OPTIONS.find((o) => o.hours === graceHours);
    const note = (
        <div className="space-y-2">
            {KEY_NOTE}
            <p>
                {graceHours === 0
                    ? 'The old key has stopped working.'
                    : `The old key (${apiKey ? maskedPrefix(apiKey.prefix) : ''}) keeps working for ${choice?.label.toLowerCase()}, then stops. Switch your systems over before then.`}
            </p>
        </div>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={created ? 'Your replacement key' : `Rotate "${apiKey?.name ?? ''}"`} maxWidth="max-w-lg">
            {created ? (
                <SecretReveal label="API key" secret={created} note={note} onDone={onClose} />
            ) : (
                <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); rotate.mutate(); }}>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        You get a new key with the same name and permissions. To avoid downtime, keep the old key working
                        while you put the new one in place.
                    </p>
                    <fieldset>
                        <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Old key stops working</legend>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                            {GRACE_OPTIONS.map((o) => (
                                <label
                                    key={o.hours}
                                    className={cn(
                                        'cursor-pointer rounded-[3px] border px-3 py-2.5 text-center text-sm font-medium transition-colors',
                                        graceHours === o.hours
                                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                                            : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="grace"
                                        value={o.hours}
                                        checked={graceHours === o.hours}
                                        onChange={() => setGraceHours(o.hours)}
                                        className="sr-only"
                                    />
                                    {o.hours === 0 ? 'Now' : `In ${o.label}`}
                                </label>
                            ))}
                        </div>
                        {choice && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{choice.hint}</p>}
                        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                            If this key leaked or was shared by mistake, choose Now: a grace period keeps the leaked key working too.
                        </p>
                    </fieldset>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={rotate.isPending}>Cancel</Button>
                        <Button type="submit" isLoading={rotate.isPending}>Rotate key</Button>
                    </div>
                </form>
            )}
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Revoke

export function RevokeKeyDialog({ apiKey, onClose, onChanged }: KeyDialogProps) {
    const revoke = useMutation({
        mutationFn: async () => (await api.delete(`/developer/api-keys/${apiKey!.id}`)).data,
        onSuccess: () => { toast.success('Key revoked'); onChanged(); onClose(); },
        onError: (err) => toast.error(errorText(err, 'Could not revoke the key. Try again.')),
    });
    const inGrace = apiKey?.status === 'expiring' && apiKey.expiresAt;

    return (
        <Modal isOpen={apiKey !== null} onClose={onClose} title={inGrace ? 'Stop the old key now?' : 'Revoke this key?'}>
            <div className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-900 dark:text-white">{apiKey?.name}</span>{' '}
                    <code className="text-xs">{apiKey ? maskedPrefix(apiKey.prefix) : ''}</code>{' '}
                    {inGrace
                        ? `would keep working for another ${timeUntil(apiKey.expiresAt!)}. Revoking ends that now.`
                        : 'will stop working immediately.'}{' '}
                    Anything still using it gets an error. This cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={revoke.isPending}>Cancel</Button>
                    <Button type="button" variant="destructive" onClick={() => revoke.mutate()} isLoading={revoke.isPending}>
                        {inGrace ? 'Stop it now' : 'Revoke key'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
