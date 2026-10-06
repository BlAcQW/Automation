'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Badge, Button } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Empty, Panel, ReasonModal, Table, Td, Th } from '../../_components/parts';
import { errorMessage, formatDate, formatDateTime, timeAgo } from '../../_components/format';

interface AdminApiKey {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: string;
    createdBy: { id: string; name: string | null; email: string | null } | null;
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    rotatedFromId: string | null;
    status: 'active' | 'expiring' | 'expired' | 'revoked';
}

type Pending = { kind: 'one'; key: AdminApiKey } | { kind: 'all'; count: number } | null;

const STATUS: Record<AdminApiKey['status'], { label: string; variant: 'default' | 'yellow' | 'slate' | 'red' }> = {
    active: { label: 'Active', variant: 'default' },
    expiring: { label: 'In grace', variant: 'yellow' },
    expired: { label: 'Expired', variant: 'slate' },
    revoked: { label: 'Revoked', variant: 'red' },
};

/**
 * An organisation's API keys for platform admins: who made each, when it was
 * last used, and (for roles holding apikeys:revoke) revoke one or all. The API
 * enforces the permission; hiding the buttons is only courtesy.
 */
export function ApiKeysPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
    const { can } = useAdmin();
    const queryClient = useQueryClient();
    const [pending, setPending] = useState<Pending>(null);
    const queryKey = ['admin', 'tenant-api-keys', tenantId];
    const mayRevoke = can('apikeys:revoke');

    const { data: keys = [], isLoading, isError, error } = useQuery({
        queryKey,
        queryFn: async () => (await adminApi.get(`/admin/organisations/${tenantId}/api-keys`)).data.data as AdminApiKey[],
    });
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-overview', tenantId] }); // audit trail
    };

    const revokeOne = useMutation({
        mutationFn: async (v: { keyId: string; reason: string }) =>
            (await adminApi.post(`/admin/organisations/${tenantId}/api-keys/${v.keyId}/revoke`, { reason: v.reason })).data.data as { revoked: boolean },
        onSuccess: (d) => { toast.success(d.revoked ? 'Key revoked; the owner has been told' : 'That key was already revoked'); setPending(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not revoke the key')),
    });
    const revokeAll = useMutation({
        mutationFn: async (reason: string) =>
            (await adminApi.post(`/admin/organisations/${tenantId}/api-keys/revoke-all`, { reason })).data.data as { revoked: number },
        onSuccess: (d) => { toast.success(`${d.revoked} key${d.revoked === 1 ? '' : 's'} revoked`); setPending(null); refresh(); },
        onError: (err) => toast.error(errorMessage(err, 'Could not revoke the keys')),
    });

    const working = keys.filter((k) => k.status === 'active' || k.status === 'expiring');

    return (
        <Panel
            title={`API keys (${working.length} working)`}
            action={mayRevoke && working.length > 0 ? (
                <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'all', count: working.length })}>Revoke all</Button>
            ) : undefined}
        >
            {isLoading ? <Empty>Loading…</Empty>
                : isError ? <p className="px-6 py-4 text-sm text-red-400">{errorMessage(error, 'Could not load API keys.')}</p>
                    : !keys.length ? <Empty>No API keys.</Empty> : (
                        <Table>
                            <thead><tr><Th>Key</Th><Th>Scopes</Th><Th>Created</Th><Th>Last used</Th><Th>Status</Th><Th /></tr></thead>
                            <tbody>
                                {keys.map((k) => (
                                    <tr key={k.id} className="border-t border-white/5">
                                        <Td className="text-white">
                                            {k.name}
                                            <span className="block font-mono text-xs text-slate-500">bk_live_{k.prefix}…</span>
                                        </Td>
                                        <Td className="max-w-[14rem]">
                                            <span className="flex flex-wrap gap-1">
                                                {k.scopes.map((s) => <span key={s} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{s}</span>)}
                                            </span>
                                        </Td>
                                        <Td className="whitespace-nowrap">
                                            {formatDate(k.createdAt)}
                                            {k.createdBy && <span className="block text-xs text-slate-500">{k.createdBy.name ?? k.createdBy.email ?? 'a user'}</span>}
                                        </Td>
                                        <Td className="whitespace-nowrap">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}</Td>
                                        <Td className="whitespace-nowrap">
                                            <Badge variant={STATUS[k.status].variant}>{STATUS[k.status].label}</Badge>
                                            {k.status === 'expiring' && k.expiresAt && <span className="block text-xs text-slate-500">until {formatDateTime(k.expiresAt)}</span>}
                                            {k.revokedAt && <span className="block text-xs text-slate-500">{formatDateTime(k.revokedAt)}</span>}
                                        </Td>
                                        <Td>
                                            {mayRevoke && (k.status === 'active' || k.status === 'expiring') && (
                                                <div className="flex justify-end">
                                                    <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'one', key: k })}>Revoke</Button>
                                                </div>
                                            )}
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}

            <ReasonModal
                isOpen={pending?.kind === 'one'}
                title={pending?.kind === 'one' ? `Revoke "${pending.key.name}"` : ''}
                description={pending?.kind === 'one'
                    ? `bk_live_${pending.key.prefix}… stops working immediately for ${tenantName}. The owner gets an in-app notice with your reason.`
                    : undefined}
                confirmLabel="Revoke key"
                busy={revokeOne.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => pending?.kind === 'one' && revokeOne.mutate({ keyId: pending.key.id, reason })}
            />
            <ReasonModal
                isOpen={pending?.kind === 'all'}
                title="Revoke every API key"
                description={pending?.kind === 'all'
                    ? `All ${pending.count} working key${pending.count === 1 ? '' : 's'} for ${tenantName} stop working immediately, including keys in a rotation grace period. Their integrations will fail until the owner creates new keys. The owner is notified with your reason.`
                    : undefined}
                confirmLabel="Revoke all keys"
                busy={revokeAll.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => revokeAll.mutate(reason)}
            />
        </Panel>
    );
}
