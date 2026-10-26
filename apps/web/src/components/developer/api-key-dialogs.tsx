'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { notify } from '@/components/brand/toast';
import { Button, ConfirmDialog, DashboardInput, Modal, SkeletonList, cn } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { SecretReveal } from './secret-reveal';
import { DEFAULT_GRACE_HOURS, GRACE_OPTIONS, errorText, maskedPrefix, timeUntil, type ApiKey, type ScopeInfo } from './types';

const KEY_NOTE = (
    <p>
        Send it as <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">Authorization: Bearer &lt;key&gt;</code>.
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
        onError: (err) => notify.error(errorText(err, 'Could not create the key. Try again.')),
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
                        <legend className="mb-1 text-small font-medium text-text">What can this key do?</legend>
                        <ScopePicker query={scopesQuery} selected={scopes} onToggle={toggle} />
                    </fieldset>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
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
    if (query.isLoading) return <div aria-busy="true" className="space-y-2"><span className="sr-only">Loading…</span><SkeletonList rows={4} /></div>;
    if (query.isError || !query.data) {
        return (
            <p className="text-[15px] text-error-fg">
                Could not load the permissions.{' '}
                <button type="button" className="min-h-[44px] font-semibold underline" onClick={() => query.refetch()}>Try again</button>
            </p>
        );
    }
    return (
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-control border border-border p-1">
            {query.data.map((s) => {
                const on = selected.includes(s.scope);
                return (
                    <label
                        key={s.scope}
                        className={cn(
                            'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5 transition-colors duration-ui',
                            on ? 'bg-primary-soft' : 'hover:bg-surface-2',
                        )}
                    >
                        <input
                            type="checkbox"
                            checked={on}
                            onChange={() => onToggle(s.scope)}
                            className="mt-1 h-5 w-5 rounded border-border accent-primary"
                        />
                        <span className="min-w-0">
                            <span className="block font-mono text-[13px] font-semibold text-text">{s.scope}</span>
                            <span className="block text-[14px] text-muted">{s.description}</span>
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
        onError: (err) => notify.error(errorText(err, 'Could not rotate the key. Try again.')),
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
                    <p className="text-[15px] leading-relaxed text-text">
                        You get a new key with the same name and permissions. To avoid downtime, keep the old key working
                        while you put the new one in place.
                    </p>
                    <fieldset>
                        <legend className="mb-2 text-small font-medium text-text">Old key stops working</legend>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                            {GRACE_OPTIONS.map((o) => (
                                <label
                                    key={o.hours}
                                    className={cn(
                                        'flex min-h-[44px] cursor-pointer items-center justify-center rounded-control border px-3 py-2.5 text-center text-[15px] font-semibold transition-colors duration-ui has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                                        graceHours === o.hours
                                            ? 'border-primary bg-primary-soft text-primary'
                                            : 'border-border text-text hover:border-text/30',
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
                        {choice && <p className="mt-2 text-[14px] text-muted">{choice.hint}</p>}
                        <p className="mt-3 rounded-control bg-warning-soft p-3 text-[14px] font-medium text-warning-fg">
                            If this key leaked or was shared by mistake, choose Now: a grace period keeps the leaked key working too.
                        </p>
                    </fieldset>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={rotate.isPending}>Cancel</Button>
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
        onSuccess: () => { notify.success('Key revoked'); onChanged(); onClose(); },
        onError: (err) => notify.error(errorText(err, 'Could not revoke the key. Try again.')),
    });
    const inGrace = apiKey?.status === 'expiring' && apiKey.expiresAt;

    return (
        <ConfirmDialog
            isOpen={apiKey !== null}
            onClose={onClose}
            onConfirm={() => revoke.mutate()}
            isLoading={revoke.isPending}
            title={inGrace ? 'Stop the old key now?' : 'Revoke this key?'}
            description={
                <>
                    <span className="font-semibold text-text">{apiKey?.name}</span>{' '}
                    <code className="text-[13px]">{apiKey ? maskedPrefix(apiKey.prefix) : ''}</code>{' '}
                    {inGrace
                        ? `would keep working for another ${timeUntil(apiKey.expiresAt!)}. Revoking ends that now.`
                        : 'will stop working straight away.'}{' '}
                    Anything still using it gets an error. You can&apos;t undo this.
                </>
            }
            confirmLabel={inGrace ? 'Stop it now' : 'Revoke key'}
            cancelLabel="Keep it"
        />
    );
}
