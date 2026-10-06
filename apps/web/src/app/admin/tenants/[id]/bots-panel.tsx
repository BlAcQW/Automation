'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bot, Check } from 'lucide-react';
import { Badge, Button } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Empty, Panel } from '../../_components/parts';
import { errorMessage } from '../../_components/format';

interface Pack {
    key: string;
    name: string;
    description: string;
    vertical: 'RIDES' | 'APPOINTMENTS';
    compatible: boolean;
    installed: boolean;
}

interface InstallResult {
    settingsCreated: boolean;
    flowVersion: number;
    flowPublished: boolean;
    upToDate: boolean;
}

/**
 * Bots an organisation can run (today: TURBO's rides bot). Install is one
 * click with a confirm; re-installing only updates the wording if it changed
 * and never overwrites settings the organisation edited. Needs flows:write.
 */
export function BotsPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
    const { can } = useAdmin();
    const queryClient = useQueryClient();
    const [confirming, setConfirming] = useState<string | null>(null);
    const queryKey = ['admin', 'tenant-packs', tenantId];
    const mayInstall = can('flows:write');

    const { data, isLoading, isError, error } = useQuery({
        queryKey,
        queryFn: async () => (await adminApi.get(`/admin/tenants/${tenantId}/packs`)).data.data as Pack[],
    });

    const install = useMutation({
        mutationFn: async (key: string) =>
            (await adminApi.post(`/admin/tenants/${tenantId}/packs/${key}/install`)).data.data as InstallResult,
        onSuccess: (r) => {
            toast.success(
                r.upToDate
                    ? 'Already up to date: nothing changed'
                    : `Installed: bot version ${r.flowVersion}${r.settingsCreated ? ', default ride settings added' : ''}`,
            );
            setConfirming(null);
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-overview', tenantId] });
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not install the bot')),
    });

    if (isLoading) return <Panel title="Bot"><Empty>Loading…</Empty></Panel>;
    if (isError) return <Panel title="Bot"><Empty>{errorMessage(error, 'Could not load bots')}</Empty></Panel>;

    return (
        <Panel title="Bot">
            <ul className="divide-y divide-white/5">
                {(data ?? []).map((p) => (
                    <li key={p.key} className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex gap-3">
                            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-white">{p.name}</span>
                                    {p.installed
                                        ? <Badge variant="default" dot>Installed</Badge>
                                        : p.compatible
                                            ? <Badge variant="slate">Not installed</Badge>
                                            : <Badge variant="yellow">Needs a {p.vertical} organisation</Badge>}
                                </div>
                                <p className="mt-1 max-w-xl text-sm text-slate-400">{p.description}</p>
                            </div>
                        </div>
                        {mayInstall && p.compatible && (
                            confirming === p.key ? (
                                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                                    <span className="text-sm text-slate-300">
                                        {p.installed
                                            ? `Update ${tenantName}'s bot to the latest wording? Their settings stay as they are.`
                                            : `Switch ${tenantName} to ${p.name}? Customers will get this bot on their next message.`}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={install.isPending}>Cancel</Button>
                                        <Button size="sm" onClick={() => install.mutate(p.key)} disabled={install.isPending}>
                                            <Check className="h-4 w-4" /> {install.isPending ? 'Installing…' : 'Yes, install'}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Button size="sm" variant={p.installed ? 'ghost' : 'default'} onClick={() => setConfirming(p.key)}>
                                    {p.installed ? 'Update bot' : `Install ${p.name}`}
                                </Button>
                            )
                        )}
                    </li>
                ))}
            </ul>
        </Panel>
    );
}
