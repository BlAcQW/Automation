'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, RefreshCw, Ban } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, StatusPill } from '@bookingflow/ui';
import { api } from '@/lib/api';
import { QueryState } from '@/components/query-state';
import { CreateKeyDialog, RevokeKeyDialog, RotateKeyDialog } from './api-key-dialogs';
import { formatDate, maskedPrefix, timeAgo, timeUntil, type ApiKey } from './types';

const KEYS_QUERY = ['developer', 'api-keys'] as const;

export function ApiKeysCard() {
    const queryClient = useQueryClient();
    const [creating, setCreating] = useState(false);
    const [rotating, setRotating] = useState<ApiKey | null>(null);
    const [revoking, setRevoking] = useState<ApiKey | null>(null);

    const { data: keys = [], isLoading, isError, refetch } = useQuery({
        queryKey: KEYS_QUERY,
        queryFn: async () => (await api.get('/developer/api-keys')).data.data as ApiKey[],
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY });
    const actions = { onRotate: setRotating, onRevoke: setRevoking };

    // Live keys first (newest first within each group), dead ones after.
    const live = keys.filter((k) => k.status === 'active' || k.status === 'expiring');
    const dead = keys.filter((k) => k.status === 'revoked' || k.status === 'expired');

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle>
                    <KeyRound className="h-5 w-5 text-primary" aria-hidden />
                    API keys
                </CardTitle>
                {keys.length > 0 && (
                    <Button size="sm" onClick={() => setCreating(true)}>
                        <Plus className="h-4 w-4" aria-hidden /> Create key
                    </Button>
                )}
            </CardHeader>
            <CardContent className="p-0">
                <p className="px-5 py-4 text-[15px] leading-relaxed text-muted sm:px-6">
                    A key lets your own software use Bookly as your business. Give each system its own key with only the
                    permissions it needs, and rotate keys instead of sharing them.
                </p>
                <QueryState
                    isLoading={isLoading}
                    isError={isError}
                    onRetry={() => refetch()}
                    isEmpty={keys.length === 0}
                    empty={
                        <div className="border-t border-border">
                            <EmptyState
                                icon={<KeyRound />}
                                title="No API keys yet"
                                description="Create one when you're ready to connect a system."
                                action={
                                    <Button onClick={() => setCreating(true)}>
                                        <Plus className="h-4 w-4" aria-hidden /> Create key
                                    </Button>
                                }
                            />
                        </div>
                    }
                >
                    <KeyTable keys={[...live, ...dead]} {...actions} />
                    <KeyList keys={[...live, ...dead]} {...actions} />
                </QueryState>
            </CardContent>

            <CreateKeyDialog isOpen={creating} onClose={() => setCreating(false)} onChanged={refresh} />
            <RotateKeyDialog apiKey={rotating} onClose={() => setRotating(null)} onChanged={refresh} />
            <RevokeKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} onChanged={refresh} />
        </Card>
    );
}

interface RowActions {
    onRotate: (k: ApiKey) => void;
    onRevoke: (k: ApiKey) => void;
}

/** Icon + word + colour. */
function KeyStatus({ apiKey }: { apiKey: ApiKey }) {
    switch (apiKey.status) {
        case 'active':
            return <StatusPill status="active" label="Active" />;
        case 'expiring':
            return (
                <StatusPill
                    status="pending"
                    label={`Stops in ${timeUntil(apiKey.expiresAt!)}`}
                    title={apiKey.expiresAt ? `Stops working ${new Date(apiKey.expiresAt).toLocaleString()}` : undefined}
                />
            );
        case 'expired':
            return <StatusPill status="expired" tone="neutral" label="Expired" />;
        default:
            return <StatusPill status="failed" label="Revoked" />;
    }
}

function ScopeChips({ scopes }: { scopes: string[] }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => (
                <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-text">{s}</span>
            ))}
        </div>
    );
}

function RowButtons({ apiKey, onRotate, onRevoke }: RowActions & { apiKey: ApiKey }) {
    if (apiKey.status === 'active') {
        return (
            <div className="flex flex-wrap gap-2 md:justify-end">
                <Button size="sm" variant="secondary" onClick={() => onRotate(apiKey)}>
                    <RefreshCw className="h-4 w-4" aria-hidden /> Rotate
                </Button>
                <Button size="sm" variant="ghost" className="text-error-fg" onClick={() => onRevoke(apiKey)}>
                    <Ban className="h-4 w-4" aria-hidden /> Revoke
                </Button>
            </div>
        );
    }
    if (apiKey.status === 'expiring') {
        return (
            <div className="flex md:justify-end">
                <Button size="sm" variant="ghost" className="text-error-fg" onClick={() => onRevoke(apiKey)}>
                    <Ban className="h-4 w-4" aria-hidden /> Stop now
                </Button>
            </div>
        );
    }
    return null;
}

const dimmed = (k: ApiKey) => (k.status === 'revoked' || k.status === 'expired' ? 'opacity-70' : '');

function KeyTable({ keys, ...actions }: RowActions & { keys: ApiKey[] }) {
    return (
        <div className="hidden md:block">
            <table className="w-full text-left text-[15px]">
                <thead className="border-y border-border bg-surface-2 text-[13px] text-muted">
                    <tr>
                        <th className="px-6 py-3 font-semibold">Name</th>
                        <th className="px-3 py-3 font-semibold">Permissions</th>
                        <th className="px-3 py-3 font-semibold">Created</th>
                        <th className="px-3 py-3 font-semibold">Last used</th>
                        <th className="px-3 py-3 font-semibold">Status</th>
                        <th className="px-6 py-3"><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {keys.map((k) => (
                        <tr key={k.id} className={dimmed(k)}>
                            <td className="px-6 py-4 align-top">
                                <p className="font-semibold text-text">{k.name}</p>
                                <code className="text-[13px] text-muted">{maskedPrefix(k.prefix)}</code>
                                {k.rotatedFromId && <p className="text-[13px] text-muted">Replacement key</p>}
                            </td>
                            <td className="max-w-[16rem] px-3 py-4 align-top"><ScopeChips scopes={k.scopes} /></td>
                            <td className="whitespace-nowrap px-3 py-4 align-top text-muted">{formatDate(k.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-4 align-top text-muted">{timeAgo(k.lastUsedAt)}</td>
                            <td className="whitespace-nowrap px-3 py-4 align-top"><KeyStatus apiKey={k} /></td>
                            <td className="px-6 py-4 align-top"><RowButtons apiKey={k} {...actions} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function KeyList({ keys, ...actions }: RowActions & { keys: ApiKey[] }) {
    return (
        <ul className="divide-y divide-border border-t border-border md:hidden">
            {keys.map((k) => (
                <li key={k.id} className={`space-y-3 px-5 py-4 ${dimmed(k)}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="truncate font-semibold text-text">{k.name}</p>
                            <code className="text-[13px] text-muted">{maskedPrefix(k.prefix)}</code>
                        </div>
                        <KeyStatus apiKey={k} />
                    </div>
                    <ScopeChips scopes={k.scopes} />
                    <p className="text-[14px] text-muted">
                        Created {formatDate(k.createdAt)} · Last used {timeAgo(k.lastUsedAt).toLowerCase()}
                    </p>
                    <RowButtons apiKey={k} {...actions} />
                </li>
            ))}
        </ul>
    );
}
