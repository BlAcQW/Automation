'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Workflow } from 'lucide-react';
import { Badge, Button, ErrorState, SkeletonList, StatusPill } from '@bookingflow/ui';
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

    const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
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
        onError: (err) => toast.error(errorMessage(err, "Couldn't install it. Let's try again.")),
    });

    if (isLoading) {
        return (
            <Panel title="Automatic replies">
                <div aria-busy="true" className="px-4 sm:px-6"><span className="sr-only">Loading…</span><SkeletonList rows={1} /></div>
            </Panel>
        );
    }
    if (isError) {
        return (
            <Panel title="Automatic replies">
                <ErrorState title="We couldn't load the reply packs" description={errorMessage(error, 'Check your connection and try again.')} onRetry={() => refetch()} isRetrying={isRefetching} />
            </Panel>
        );
    }

    return (
        <Panel title="Automatic replies">
            {!(data ?? []).length && <Empty>No reply packs are available for this business.</Empty>}
            <ul className="divide-y divide-border">
                {(data ?? []).map((p) => (
                    <li key={p.key} className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                        <div className="flex gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                                <Workflow className="h-5 w-5" aria-hidden />
                            </span>
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-text">{p.name}</span>
                                    {p.installed
                                        ? <StatusPill size="sm" status="installed" tone="success" />
                                        : p.compatible
                                            ? <StatusPill size="sm" status="not_installed" tone="neutral" label="Not installed" />
                                            : <Badge variant="warning">Needs a {p.vertical} business</Badge>}
                                </div>
                                <p className="mt-1 max-w-xl text-[15px] text-muted">{p.description}</p>
                            </div>
                        </div>
                        {mayInstall && p.compatible && (
                            confirming === p.key ? (
                                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                                    <span className="text-[15px] text-text">
                                        {p.installed
                                            ? `Update ${tenantName}'s bot to the latest wording? Their settings stay as they are.`
                                            : `Switch ${tenantName} to ${p.name}? Customers get these replies from their next message.`}
                                    </span>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="secondary" size="sm" onClick={() => setConfirming(null)} disabled={install.isPending}>Cancel</Button>
                                        <Button size="sm" onClick={() => install.mutate(p.key)} isLoading={install.isPending} loadingText="Installing…">
                                            <Check className="h-4 w-4" aria-hidden /> Yes, install
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Button size="sm" variant={p.installed ? 'secondary' : 'primary'} onClick={() => setConfirming(p.key)}>
                                    {p.installed ? 'Update wording' : `Install ${p.name}`}
                                </Button>
                            )
                        )}
                    </li>
                ))}
            </ul>
        </Panel>
    );
}
