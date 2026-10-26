'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Power, PowerOff, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Textarea } from '@bookingflow/ui';
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
            toast.success(v.active ? "Business reactivated. We've let the owner know." : "Business deactivated. We've let the owner know.");
            setPending(null);
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-overview', tenantId] });
            queryClient.invalidateQueries({ queryKey: checkKey });
            queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
        },
        onError: (err) => toast.error(errorMessage(err, "Couldn't change the business. Let's try again.")),
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
            toast.error(errorMessage(err, "Couldn't delete the business. Let's try again."));
            queryClient.invalidateQueries({ queryKey: checkKey });
        },
    });

    if (!mayManage) return null;

    const shown = check.data?.blockers ?? [];

    return (
        <section id="danger-zone">
            <Panel title="Danger zone">
                <ul className="divide-y divide-border border-t-2 border-error/40">
                    <li className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
                        <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-text">{isActive ? 'Deactivate this business' : 'Reactivate this business'}</p>
                            <p className="mt-1 text-[14px] text-muted">
                                {isActive
                                    ? 'Stops sign-in, automatic replies, outgoing messages and API keys. Nothing is deleted and you can undo it.'
                                    : 'This business is deactivated. Reactivating brings back sign-in, automatic replies and API keys.'}
                            </p>
                        </div>
                        {isActive ? (
                            <Button size="sm" variant="destructive" onClick={() => setPending('deactivate')}><PowerOff className="h-4 w-4" aria-hidden /> Deactivate</Button>
                        ) : (
                            <Button size="sm" variant="secondary" onClick={() => setPending('reactivate')}><Power className="h-4 w-4" aria-hidden /> Reactivate</Button>
                        )}
                    </li>
                    <li className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-6">
                        <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold text-text">Delete permanently</p>
                            <p className="mt-1 text-[14px] text-muted">
                                Removes the business and everything in it. Its channels are disconnected from Meta first. The audit log keeps a record. This can&apos;t be undone.
                            </p>
                            {check.isError && (
                                <p className="mt-2 text-[14px] text-warning-fg">{errorMessage(check.error, "We couldn't check whether this business can be deleted.")}</p>
                            )}
                            {shown.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {shown.map((b) => (
                                        <li key={b.code} className="flex items-start gap-2 text-[14px] text-warning-fg">
                                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b.message}
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
                            <Trash2 className="h-4 w-4" aria-hidden /> Delete permanently
                        </Button>
                    </li>
                </ul>
            </Panel>

            <ReasonModal
                isOpen={pending === 'deactivate'}
                title={`Deactivate ${tenantName}`}
                description="Staff are signed out within seconds, automatic replies stop, and outgoing messages and API keys stop working. The owner is told in the app. You can reactivate later."
                confirmLabel="Deactivate"
                minLength={3}
                busy={setActive.isPending}
                onClose={() => setPending(null)}
                onConfirm={(reason) => setActive.mutate({ active: false, reason })}
            />
            <ReasonModal
                isOpen={pending === 'reactivate'}
                title={`Reactivate ${tenantName}`}
                description="Sign-in, automatic replies and API keys start working again. The owner is told in the app."
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

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Delete ${tenantName} permanently`}>
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (nameOk && reasonOk && !busy) onConfirm({ confirmName: typed.trim(), reason: reason.trim() });
                }}
            >
                <div className="rounded-card border border-error/40 bg-error-soft p-3 text-[14px] text-error-fg">
                    <p className="font-semibold">This can&apos;t be undone.</p>
                    {removals.length > 0 ? (
                        <>
                            <p className="mt-1">These will be removed:</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                {removals.map((r) => <li key={r}>{r}</li>)}
                            </ul>
                        </>
                    ) : (
                        <p className="mt-1">The business has no data beyond its settings.</p>
                    )}
                    <p className="mt-2">WhatsApp, Facebook and Instagram are disconnected first. The audit log keeps a record of the deletion.</p>
                </div>
                <Textarea
                    id="delete-reason"
                    label="Reason (saved in the audit log)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="Why is this business being deleted?"
                />
                <Input
                    id="delete-confirm"
                    label={`Type "${tenantName}" to confirm`}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    error={typed.trim().length > 0 && !nameOk ? 'The name must match exactly, including capital letters.' : undefined}
                />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button type="submit" variant="destructive" disabled={!nameOk || !reasonOk || busy} isLoading={busy}>
                        <Trash2 className="h-4 w-4" aria-hidden /> Delete permanently
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
