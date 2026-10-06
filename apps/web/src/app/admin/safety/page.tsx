'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Badge, Button } from '@bookingflow/ui';
import { BooklyDots } from '@/components/primitives/bookly-dots';
import { useAdmin } from '../admin-context';
import { Empty, Panel, ReasonModal, Table, Td, Th } from '../_components/parts';
import { errorMessage, formatDateTime } from '../_components/format';

type Kind = 'outbound' | 'payouts';
const META: Record<Kind, { label: string; permission: string; hint: string }> = {
    payouts: { label: 'All payouts', permission: 'payouts:platform_switch', hint: 'Stops every withdrawal and automatic payout for every organisation. Use during a payment-provider incident or a suspected breach.' },
    outbound: { label: 'All outbound messages', permission: 'outbound:platform_switch', hint: 'Stops every WhatsApp, SMS, email and webhook send for every organisation. Use during a carrier or Meta incident.' },
};

export default function AdminSafetyPage() {
    const { can } = useAdmin();
    const queryClient = useQueryClient();
    const [pausing, setPausing] = useState<Kind | null>(null);

    const switches = useQuery({
        queryKey: ['admin', 'platform-switches'],
        queryFn: async () => (await adminApi.get('/admin/platform/switches')).data as Record<Kind, { paused: boolean; reason?: string }>,
    });
    const sessions = useQuery({
        queryKey: ['admin', 'support-sessions'],
        queryFn: async () => (await adminApi.get('/admin/support-sessions?limit=50')).data.data as any[],
        enabled: can('audit:read'),
    });

    const set = useMutation({
        mutationFn: async (v: { kind: Kind; paused: boolean; reason?: string }) =>
            (await adminApi.put(`/admin/platform/switches/${v.kind}`, { paused: v.paused, reason: v.reason })).data,
        onSuccess: (_d, v) => {
            toast.success(`${META[v.kind].label} ${v.paused ? 'paused' : 'resumed'}`);
            setPausing(null);
            queryClient.invalidateQueries({ queryKey: ['admin', 'platform-switches'] });
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not change the switch')),
    });

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Safety switches</h1>
                <p className="text-slate-400">Platform-wide emergency stops, and who has been looking at organisations. Per-organisation switches are on each organisation&apos;s page.</p>
            </div>

            <Panel title="Platform-wide switches">
                {switches.isLoading ? <div className="flex h-24 items-center justify-center"><BooklyDots size="md" /></div> : (
                    <ul className="divide-y divide-white/5">
                        {(['payouts', 'outbound'] as Kind[]).map((kind) => {
                            const state = switches.data?.[kind];
                            const meta = META[kind];
                            return (
                                <li key={kind} className="flex items-center justify-between gap-4 px-6 py-4">
                                    <div>
                                        <p className="text-sm font-medium text-white">
                                            {meta.label} {state?.paused ? <Badge variant="red">Paused</Badge> : <Badge variant="default">Running</Badge>}
                                        </p>
                                        {state?.paused && state.reason && <p className="mt-1 text-xs text-slate-400">Reason: {state.reason}</p>}
                                        <p className="mt-1 text-xs text-slate-500">{meta.hint}</p>
                                    </div>
                                    {can(meta.permission) && (
                                        state?.paused ? (
                                            <Button size="sm" variant="outline" isLoading={set.isPending} onClick={() => set.mutate({ kind, paused: false })}><PlayCircle className="h-4 w-4" /> Resume</Button>
                                        ) : (
                                            <Button size="sm" variant="destructive" onClick={() => setPausing(kind)}><PauseCircle className="h-4 w-4" /> Pause</Button>
                                        )
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Panel>

            {can('audit:read') && (
                <Panel title="Support access sessions">
                    {sessions.isLoading ? <div className="flex h-24 items-center justify-center"><BooklyDots size="md" /></div> : !sessions.data?.length ? <Empty>No support sessions yet.</Empty> : (
                        <Table>
                            <thead><tr><Th>Started</Th><Th>Admin</Th><Th>Organisation</Th><Th>Reason</Th><Th>Status</Th></tr></thead>
                            <tbody>
                                {sessions.data.map((s) => {
                                    const live = !s.endedAt && new Date(s.expiresAt) > new Date();
                                    return (
                                        <tr key={s.id} className="border-t border-white/5">
                                            <Td className="whitespace-nowrap">{formatDateTime(s.createdAt)}</Td>
                                            <Td>{s.admin?.name ?? s.adminId}</Td>
                                            <Td><Link href={`/admin/tenants/${s.tenantId}`} className="text-white hover:text-emerald-400">{s.tenant?.name ?? s.tenantId}</Link></Td>
                                            <Td>{s.reason}</Td>
                                            <Td><Badge variant={live ? 'blue' : 'slate'}>{live ? 'Live' : s.endedAt ? 'Ended' : 'Expired'}</Badge></Td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                    <p className="px-6 py-3 text-xs text-slate-500">
                        Everything done during a session is in the <Link href="/admin/audit?actionPrefix=support." className="text-emerald-400 hover:underline">audit log</Link> (filter &quot;support.&quot;).
                    </p>
                </Panel>
            )}

            <ReasonModal
                isOpen={pausing !== null}
                title={pausing ? `Pause ${META[pausing].label.toLowerCase()}` : ''}
                description={pausing ? META[pausing].hint : undefined}
                confirmLabel="Pause for everyone"
                busy={set.isPending}
                onClose={() => setPausing(null)}
                onConfirm={(reason) => pausing && set.mutate({ kind: pausing, paused: true, reason })}
            />
        </div>
    );
}
