'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Power, PowerOff, Trash2 } from 'lucide-react';
import { Button, Modal } from '@bookingflow/ui';
import { adminApi } from '@/lib/api';
import { useAdmin } from '../../admin-context';
import { Panel, ReasonModal } from '../../_components/parts';
import { errorMessage } from '../../_components/format';

interface Blocker {
    code: 'NOT_DEACTIVATED' | 'MONEY_HISTORY' | 'OPEN_PAYMENT_LINKS';
    message: string;
    count: number;
}

interface DeleteCheck {
    canDelete: boolean;
    blockers: Blocker[];
    counts: Record<string, number>;
}

/** What "will be removed" lists, in this order, with plain labels. Zero counts are skipped. */
const COUNT_LABELS: Array<[key: string, one: string, many: string]> = [
    ['users', 'staff account', 'staff accounts'],
    ['customers', 'customer', 'customers'],
    ['conversations', 'conversation', 'conversations'],
    ['messages', 'message', 'messages'],
    ['bookings', 'booking', 'bookings'],
    ['orders', 'order', 'orders'],
    ['services', 'service', 'services'],
    ['products', 'product', 'products'],
    ['rides', 'ride', 'rides'],
    ['passes', 'ride pass', 'ride passes'],
    ['drivers', 'driver', 'drivers'],
    ['flows', 'workflow version', 'workflow versions'],
    ['apiKeys', 'API key', 'API keys'],
    ['webhookSubscriptions', 'webhook subscription', 'webhook subscriptions'],
    ['notifications', 'notification', 'notifications'],
];

function removalList(counts: Record<string, number>): string[] {
    return COUNT_LABELS
        .filter(([key]) => (counts[key] ?? 0) > 0)
        .map(([key, one, many]) => `${counts[key].toLocaleString()} ${counts[key] === 1 ? one : many}`);
}

/**
 * Deactivate / reactivate an organisation and delete it permanently.
 * Every action here needs tenants:delete (OWNER); the API enforces it, the
 * buttons only mirror it. Delete is offered only when the server's
 * delete-check allows it, and asks for a reason plus the exact name.
 */
export function DangerZonePanel({ tenantId, tenantName, isActive }: { tenantId: string; tenantName: string; isActive: boolean }) {
    const { can } = useAdmin();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [pending, setPending] = useState<'deactivate' | 'reactivate' | 'delete' | null>(null);
    const mayManage = can('tenants:delete');
    const checkKey = ['admin', 'tenant-delete-check', tenantId];

    const check = useQuery({
        queryKey: checkKey,
        queryFn: async () => (await adminApi.get(`/admin/tenants/${tenantId}/delete-check`)).data.data as DeleteCheck,
        enabled: mayManage,
    });

    const setActive = useMutation({
        mutationFn: async (v: { active: boolean; reason: string }) =>
            (await adminApi.post(`/admin/tenants/${tenantId}/${v.active ? 'reactivate' : 'deactivate'}`, { reason: v.reason })).data.data,
        onSuccess: (_d, v) => {
            toast.success(v.active ? 'Organisation reactivated; the owner has been told' : 'Organisation deactivated; the owner has been told');
            setPending(null);
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-overview', tenantId] });
            queryClient.invalidateQueries({ queryKey: checkKey });
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not change the organisation')),
    });

    const remove = useMutation({
        mutationFn: async (v: { confirmName: string; reason: string }) =>
            (await adminApi.post(`/admin/tenants/${tenantId}/delete`, v)).data.data as { name: string },
        onSuccess: (d) => {
            toast.success(`${d.name} was deleted permanently`);
            setPending(null);
            queryClient.removeQueries({ queryKey: ['admin', 'tenant-overview', tenantId] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
            router.push('/admin/tenants');
        },
        onError: (err) => {
            toast.error(errorMessage(err, 'Could not delete the organisation'));
            queryClient.invalidateQueries({ queryKey: checkKey });
        },
    });

    if (!mayManage) return null;

    const shown = check.data?.blockers ?? [];

    return (
        <section id="danger-zone">
            <Panel title="Danger zone">
                <ul className="divide-y divide-white/5">
                    <li className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-white">{isActive ? 'Deactivate organisation' : 'Reactivate organisation'}</p>
                            <p className="mt-1 text-xs text-slate-500">
                                {isActive
                                    ? 'Stops sign-in, the bot, outgoing messages and API keys. Nothing is deleted and it can be undone.'
                                    : 'This organisation is deactivated. Reactivating restores sign-in, the bot and API keys.'}
                            </p>
                        </div>
                        {isActive ? (
                            <Button size="sm" variant="destructive" onClick={() => setPending('deactivate')}><PowerOff className="h-4 w-4" /> Deactivate</Button>
                        ) : (
                            <Button size="sm" variant="outline" onClick={() => setPending('reactivate')}><Power className="h-4 w-4" /> Reactivate</Button>
                        )}
                    </li>
                    <li className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white">Delete permanently</p>
                            <p className="mt-1 text-xs text-slate-500">
                                Removes the organisation and everything in it. Its channels are disconnected from Meta first. The audit log keeps a record. This cannot be undone.
                            </p>
                            {check.isError && (
                                <p className="mt-2 text-xs text-amber-300">{errorMessage(check.error, 'Could not check whether this organisation can be deleted.')}</p>
                            )}
                            {shown.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {shown.map((b) => (
                                        <li key={b.code} className="flex items-start gap-2 text-xs text-amber-300">
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {b.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={!check.data?.canDelete}
                            isLoading={check.isLoading}
                            onClick={() => setPending('delete')}
                        >
                            <Trash2 className="h-4 w-4" /> Delete permanently
                        </Button>
                    </li>
                </ul>
            </Panel>

            <ReasonModal
                isOpen={pending === 'deactivate'}
                title={`Deactivate ${tenantName}`}
                description="Staff are signed out within seconds, the bot stops answering, outgoing messages and API keys stop working. The owner is told in the app. You can reactivate later."
                confirmLabel="Deactivate"
                minLength={3}
                busy={setActive.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => setActive.mutate({ active: false, reason })}
            />
            <ReasonModal
                isOpen={pending === 'reactivate'}
                title={`Reactivate ${tenantName}`}
                description="Sign-in, the bot and API keys start working again. The owner is told in the app."
                confirmLabel="Reactivate"
                minLength={3}
                busy={setActive.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => setActive.mutate({ active: true, reason })}
            />
            <DeleteModal
                isOpen={pending === 'delete'}
                tenantName={tenantName}
                removals={removalList(check.data?.counts ?? {})}
                busy={remove.isPending}
                onClose={() => setPending(null)}
                onConfirm={(v) => remove.mutate(v)}
            />
        </section>
    );
}

function DeleteModal({
    isOpen, tenantName, removals, busy, onClose, onConfirm,
}: {
    isOpen: boolean;
    tenantName: string;
    removals: string[];
    busy: boolean;
    onClose: () => void;
    onConfirm: (v: { confirmName: string; reason: string }) => void;
}) {
    const [reason, setReason] = useState('');
    const [typed, setTyped] = useState('');
    useEffect(() => { if (!isOpen) { setReason(''); setTyped(''); } }, [isOpen]);
    const nameOk = typed.trim().length > 0 && typed.trim() === tenantName.trim();
    const reasonOk = reason.trim().length >= 3;
    const field = 'w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-rose-500 focus:outline-none';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Delete ${tenantName} permanently`}>
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (nameOk && reasonOk && !busy) onConfirm({ confirmName: typed.trim(), reason: reason.trim() });
                }}
            >
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">
                    <p className="font-medium">This cannot be undone.</p>
                    {removals.length > 0 ? (
                        <>
                            <p className="mt-1 text-rose-200/80">These will be removed:</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-rose-200/80">
                                {removals.map((r) => <li key={r}>{r}</li>)}
                            </ul>
                        </>
                    ) : (
                        <p className="mt-1 text-rose-200/80">The organisation has no data beyond its settings.</p>
                    )}
                    <p className="mt-2 text-rose-200/80">WhatsApp, Facebook and Instagram are disconnected first. The audit log keeps a record of the deletion.</p>
                </div>
                <div className="space-y-1.5">
                    <label htmlFor="delete-reason" className="block text-sm font-medium text-slate-300">Reason (recorded in the audit log)</label>
                    <textarea id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} className={field} placeholder="Why is this organisation being deleted?" />
                </div>
                <div className="space-y-1.5">
                    <label htmlFor="delete-confirm" className="block text-sm font-medium text-slate-300">
                        Type <span className="font-mono text-white">{tenantName}</span> to confirm
                    </label>
                    <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={field} />
                    {typed.trim().length > 0 && !nameOk && <p className="text-xs text-amber-300">The name must match exactly, including capital letters.</p>}
                </div>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="destructive" disabled={!nameOk || !reasonOk || busy} isLoading={busy}>
                        <Trash2 className="h-4 w-4" /> Delete permanently
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
