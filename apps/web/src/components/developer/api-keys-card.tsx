'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, RefreshCw, Ban } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@bookingflow/ui';
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
                    <KeyRound className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    API keys
                </CardTitle>
                <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus className="h-4 w-4" /> Create key
                </Button>
            </CardHeader>
            <CardContent className="p-0">
                <p className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                    Keys let your own software use the Bookly API as your business. Give each system its own key with only the
                    permissions it needs, and rotate keys instead of sharing them.
                </p>
                <QueryState
                    isLoading={isLoading}
                    isError={isError}
                    onRetry={() => refetch()}
                    isEmpty={keys.length === 0}
                    empty={
                        <div className="border-t border-slate-100 px-6 py-10 text-center dark:border-slate-800">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">No API keys yet</p>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create one when you are ready to connect a system.</p>
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

function StatusBadge({ apiKey }: { apiKey: ApiKey }) {
    switch (apiKey.status) {
        case 'active':
            return <Badge variant="default">Active</Badge>;
        case 'expiring':
            return <Badge variant="yellow" title={apiKey.expiresAt ? `Stops working ${new Date(apiKey.expiresAt).toLocaleString()}` : undefined}>Expires in {timeUntil(apiKey.expiresAt!)}</Badge>;
        case 'expired':
            return <Badge variant="slate">Expired</Badge>;
        default:
            return <Badge variant="red">Revoked</Badge>;
    }
}

function ScopeChips({ scopes }: { scopes: string[] }) {
    return (
        <div className="flex flex-wrap gap-1">
            {scopes.map((s) => (
                <span key={s} className="rounded-[3px] bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{s}</span>
            ))}
        </div>
    );
}

function RowButtons({ apiKey, onRotate, onRevoke }: RowActions & { apiKey: ApiKey }) {
    if (apiKey.status === 'active') {
        return (
            <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => onRotate(apiKey)}><RefreshCw className="h-3.5 w-3.5" /> Rotate</Button>
                <Button size="sm" variant="destructive" onClick={() => onRevoke(apiKey)}><Ban className="h-3.5 w-3.5" /> Revoke</Button>
            </div>
        );
    }
    if (apiKey.status === 'expiring') {
        return (
            <div className="flex justify-end">
                <Button size="sm" variant="destructive" onClick={() => onRevoke(apiKey)}><Ban className="h-3.5 w-3.5" /> Stop now</Button>
            </div>
        );
    }
    return null;
}

const muted = (k: ApiKey) => (k.status === 'revoked' || k.status === 'expired' ? 'opacity-60' : '');

function KeyTable({ keys, ...actions }: RowActions & { keys: ApiKey[] }) {
    return (
        <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-100 bg-slate-50/60 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-400">
                    <tr>
                        <th className="px-6 py-2.5 font-medium">Name</th>
                        <th className="px-3 py-2.5 font-medium">Permissions</th>
                        <th className="px-3 py-2.5 font-medium">Created</th>
                        <th className="px-3 py-2.5 font-medium">Last used</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-6 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {keys.map((k) => (
                        <tr key={k.id} className={muted(k)}>
                            <td className="px-6 py-3 align-top">
                                <p className="font-medium text-slate-900 dark:text-white">{k.name}</p>
                                <code className="text-xs text-slate-500 dark:text-slate-400">{maskedPrefix(k.prefix)}</code>
                                {k.rotatedFromId && <p className="text-[11px] text-slate-400">Replacement key</p>}
                            </td>
                            <td className="max-w-[16rem] px-3 py-3 align-top"><ScopeChips scopes={k.scopes} /></td>
                            <td className="whitespace-nowrap px-3 py-3 align-top text-slate-600 dark:text-slate-300">{formatDate(k.createdAt)}</td>
                            <td className="whitespace-nowrap px-3 py-3 align-top text-slate-600 dark:text-slate-300">{timeAgo(k.lastUsedAt)}</td>
                            <td className="whitespace-nowrap px-3 py-3 align-top"><StatusBadge apiKey={k} /></td>
                            <td className="px-6 py-3 align-top"><RowButtons apiKey={k} {...actions} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function KeyList({ keys, ...actions }: RowActions & { keys: ApiKey[] }) {
    return (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden dark:divide-slate-800 dark:border-slate-800">
            {keys.map((k) => (
                <li key={k.id} className={`space-y-2 px-4 py-4 ${muted(k)}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 dark:text-white">{k.name}</p>
                            <code className="text-xs text-slate-500 dark:text-slate-400">{maskedPrefix(k.prefix)}</code>
                        </div>
                        <StatusBadge apiKey={k} />
                    </div>
                    <ScopeChips scopes={k.scopes} />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Created {formatDate(k.createdAt)} · Last used {timeAgo(k.lastUsedAt).toLowerCase()}
                    </p>
                    <RowButtons apiKey={k} {...actions} />
                </li>
            ))}
        </ul>
    );
}
