'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Button, PageHeader, StatusPill } from '@bookingflow/ui';
import { useAdmin } from '../admin-context';
import { Empty, LoadingBlock, Panel, ReasonModal, THead, Table, Td, Th, Tr } from '../_components/parts';
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
        onError: (err) => toast.error(errorMessage(err, "Couldn't change the switch. Let's try again.")),
    });

    return (
        <div className="space-y-6">
            <PageHeader
                title="Safety switches"
                subtitle="Platform-wide emergency stops, and who has been looking at businesses. Each business has its own switches on its page."
            />

            <Panel title="Platform-wide switches">
                {switches.isLoading ? <LoadingBlock /> : (
                    <ul className="divide-y divide-border">
                        {(['payouts', 'outbound'] as Kind[]).map((kind) => {
                            const state = switches.data?.[kind];
                            const meta = META[kind];
                            return (
                                <li key={kind} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                    <div>
                                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text">
                                            {meta.label} {state?.paused ? <StatusPill size="sm" status="paused" tone="error" /> : <StatusPill size="sm" status="running" tone="success" />}
                                        </p>
                                        {state?.paused && state.reason && <p className="mt-1 text-[14px] text-muted">Reason: {state.reason}</p>}
                                        <p className="mt-1 text-[14px] text-muted">{meta.hint}</p>
                                    </div>
                                    {can(meta.permission) && (
                                        state?.paused ? (
                                            <Button size="sm" variant="secondary" isLoading={set.isPending} onClick={() => set.mutate({ kind, paused: false })}><PlayCircle className="h-4 w-4" aria-hidden /> Resume</Button>
                                        ) : (
                                            <Button size="sm" variant="destructive" onClick={() => setPausing(kind)}><PauseCircle className="h-4 w-4" aria-hidden /> Pause</Button>
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
                    {sessions.isLoading ? <LoadingBlock /> : !sessions.data?.length ? <Empty>No support sessions yet.</Empty> : (
                        <Table>
                            <THead><tr><Th>Started</Th><Th>Admin</Th><Th>Business</Th><Th>Reason</Th><Th>Status</Th></tr></THead>
                            <tbody>
                                {sessions.data.map((s) => {
                                    const live = !s.endedAt && new Date(s.expiresAt) > new Date();
                                    return (
                                        <Tr key={s.id}>
                                            <Td className="whitespace-nowrap">{formatDateTime(s.createdAt)}</Td>
                                            <Td label="Admin">{s.admin?.name ?? s.adminId}</Td>
                                            <Td label="Business"><Link href={`/admin/tenants/${s.tenantId}`} className="font-medium text-text hover:text-primary">{s.tenant?.name ?? s.tenantId}</Link></Td>
                                            <Td label="Reason">{s.reason}</Td>
                                            <Td label="Status"><StatusPill size="sm" status={live ? 'live' : s.endedAt ? 'ended' : 'expired'} tone={live ? 'warning' : 'neutral'} /></Td>
                                        </Tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                    <p className="px-4 py-3 text-[14px] text-muted sm:px-6">
                        Everything done during a session is in the <Link href="/admin/audit?actionPrefix=support." className="font-semibold text-primary hover:underline">audit log</Link> (filter &quot;support.&quot;).
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
