'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, Ticket, Pause, Play } from 'lucide-react';
import { adminApi } from '@/lib/api';
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DashboardInput,
    EmptyState,
    PageHeader,
    Select,
    SkeletonLine,
    SkeletonTableRow,
    StatusPill,
} from '@bookingflow/ui';
import { Table, THead, Td, Th, Tr } from '../_components/parts';
import { formatDate, formatDateTime } from '../_components/format';

interface PromoCode {
    id: string;
    code: string;
    kind: 'TRIAL_EXTENSION' | 'PLAN_GRANT';
    days: number;
    planId: string | null;
    description: string | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    expiresAt: string | null;
    isActive: boolean;
    createdAt: string;
    createdBy: { name: string } | null;
}

interface Redemption {
    id: string;
    redeemedAt: string;
    tenant: { id: string; name: string };
    effect: { to?: { planId?: string; trialEndsAt?: string } } | null;
}

const KIND_LABEL: Record<PromoCode['kind'], string> = {
    TRIAL_EXTENSION: 'Extend trial',
    PLAN_GRANT: 'Grant a plan',
};

export default function AdminPromoCodesPage() {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState<string | null>(null);

    // Create form
    const [kind, setKind] = useState<PromoCode['kind']>('TRIAL_EXTENSION');
    const [planId, setPlanId] = useState<'starter' | 'pro'>('pro');
    const [days, setDays] = useState('30');
    const [code, setCode] = useState('');
    const [prefix, setPrefix] = useState('');
    const [description, setDescription] = useState('');
    const [maxRedemptions, setMaxRedemptions] = useState('');
    const [expiresAt, setExpiresAt] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'promo-codes'],
        queryFn: async () => (await adminApi.get('/admin/promo-codes')).data as { data: PromoCode[] },
    });

    const { data: redemptions } = useQuery({
        queryKey: ['admin', 'promo-codes', open, 'redemptions'],
        queryFn: async () => (await adminApi.get(`/admin/promo-codes/${open}/redemptions`)).data as { data: Redemption[] },
        enabled: !!open,
    });

    const create = useMutation({
        mutationFn: async () => {
            const body: Record<string, unknown> = {
                kind,
                days: Number(days),
                ...(kind === 'PLAN_GRANT' ? { planId } : {}),
                ...(code.trim() ? { code: code.trim() } : prefix.trim() ? { prefix: prefix.trim() } : {}),
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(maxRedemptions.trim() ? { maxRedemptions: Number(maxRedemptions) } : {}),
                ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
            };
            return (await adminApi.post('/admin/promo-codes', body)).data as PromoCode;
        },
        onSuccess: (created) => {
            toast.success(`Created ${created.code}`);
            setCode(''); setPrefix(''); setDescription(''); setMaxRedemptions(''); setExpiresAt('');
            queryClient.invalidateQueries({ queryKey: ['admin', 'promo-codes'] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? "Couldn't create the code. Let's try again."),
    });

    const toggle = useMutation({
        mutationFn: async (p: PromoCode) =>
            (await adminApi.patch(`/admin/promo-codes/${p.id}`, { isActive: !p.isActive })).data as PromoCode,
        onSuccess: (p) => {
            toast.success(p.isActive ? `${p.code} is active` : `${p.code} paused`);
            queryClient.invalidateQueries({ queryKey: ['admin', 'promo-codes'] });
        },
        onError: (err: any) => toast.error(err?.response?.data?.message ?? "Couldn't update the code. Let's try again."),
    });

    const copy = async (c: string) => {
        try { await navigator.clipboard.writeText(c); toast.success('Copied'); } catch { toast.error("Couldn't copy. Select the code and copy it by hand."); }
    };

    const describe = (p: PromoCode) =>
        p.kind === 'PLAN_GRANT'
            ? `${p.days} days of ${p.planId === 'starter' ? 'Starter' : 'Pro'}`
            : `+${p.days} days of trial`;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Promo codes"
                subtitle="A business owner types the code under Settings → Plan & usage. Extend a trial, or put them on a plan for a while. No card needed."
            />

            <Card>
                <CardHeader>
                    <CardTitle>
                        <Ticket className="h-5 w-5 text-primary" aria-hidden />
                        New code
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
                        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
                    >
                        <Select label="What it does" value={kind} onChange={(e) => setKind(e.target.value as PromoCode['kind'])}>
                            <option value="TRIAL_EXTENSION">Extend the trial by N days</option>
                            <option value="PLAN_GRANT">Grant a plan for N days</option>
                        </Select>
                        {kind === 'PLAN_GRANT' && (
                            <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value as 'starter' | 'pro')}>
                                <option value="pro">Pro</option>
                                <option value="starter">Starter</option>
                            </Select>
                        )}
                        <DashboardInput label="Days" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} required />
                        <DashboardInput label="Code (leave blank to make one up)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH50" />
                        <DashboardInput label="Start made-up codes with" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="LAUNCH" disabled={!!code} />
                        <DashboardInput label="Max uses (blank = unlimited)" type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="100" />
                        <DashboardInput label="Expires on (blank = never)" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                        <div className="md:col-span-2">
                            <DashboardInput label="Note (only admins see it)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Instagram launch campaign" />
                        </div>
                        <div className="flex items-end">
                            <Button type="submit" isLoading={create.isPending} loadingText="Creating…">Create code</Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                {isLoading ? (
                    <div aria-busy="true">
                        <span className="sr-only">Loading codes…</span>
                        {Array.from({ length: 4 }).map((_, i) => <SkeletonTableRow key={i} columns={6} />)}
                    </div>
                ) : !data?.data.length ? (
                    <EmptyState
                        icon={<Ticket className="h-6 w-6" aria-hidden />}
                        title="No codes yet"
                        description="Create your first one with the form above."
                    />
                ) : (
                    <Table>
                        <THead>
                            <tr>
                                <Th>Code</Th>
                                <Th>What it does</Th>
                                <Th>Used</Th>
                                <Th>Expires</Th>
                                <Th>Status</Th>
                                <Th>Note</Th>
                                <Th className="w-1" />
                            </tr>
                        </THead>
                        <tbody>
                            {data.data.map((p) => {
                                const expired = p.expiresAt ? new Date(p.expiresAt).getTime() < Date.now() : false;
                                const exhausted = p.maxRedemptions !== null && p.redemptionCount >= p.maxRedemptions;
                                return (
                                    <Tr key={p.id}>
                                        <Td>
                                            <button
                                                onClick={() => copy(p.code)}
                                                className="inline-flex min-h-[44px] items-center gap-2 rounded-control font-mono font-semibold text-text hover:text-primary"
                                                title="Copy"
                                                aria-label={`Copy ${p.code}`}
                                            >
                                                {p.code} <Copy className="h-3.5 w-3.5 text-muted" aria-hidden />
                                            </button>
                                        </Td>
                                        <Td label="What it does">{KIND_LABEL[p.kind]}: {describe(p)}</Td>
                                        <Td label="Used" className="tabular-nums">
                                            <button
                                                onClick={() => setOpen(open === p.id ? null : p.id)}
                                                className="min-h-[44px] rounded-control underline underline-offset-2 hover:text-primary"
                                            >
                                                {p.redemptionCount}{p.maxRedemptions !== null ? ` / ${p.maxRedemptions}` : ''}
                                            </button>
                                        </Td>
                                        <Td label="Expires" className="whitespace-nowrap">{p.expiresAt ? formatDate(p.expiresAt) : 'Never'}</Td>
                                        <Td label="Status">
                                            {!p.isActive ? <StatusPill size="sm" status="paused" tone="neutral" />
                                                : expired ? <StatusPill size="sm" status="expired" />
                                                : exhausted ? <StatusPill size="sm" status="used_up" tone="warning" />
                                                : <StatusPill size="sm" status="active" />}
                                        </Td>
                                        <Td label="Note" className="text-muted md:max-w-[24ch] md:truncate">{p.description ?? ''}</Td>
                                        <Td>
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => toggle.mutate(p)}
                                                disabled={toggle.isPending}
                                                aria-label={p.isActive ? 'Pause' : 'Resume'}
                                                className="w-full md:w-11 md:px-0"
                                            >
                                                {p.isActive ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                                                <span className="md:sr-only">{p.isActive ? 'Pause' : 'Resume'}</span>
                                            </Button>
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            {open && (
                <Card>
                    <CardHeader>
                        <CardTitle>Who used {data?.data.find((p) => p.id === open)?.code}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!redemptions ? (
                            <div aria-busy="true" className="space-y-3">
                                <span className="sr-only">Loading…</span>
                                <SkeletonLine />
                                <SkeletonLine width="w-2/3" />
                            </div>
                        ) : redemptions.data.length === 0 ? (
                            <p className="text-[15px] text-muted">Nobody has used this code yet.</p>
                        ) : (
                            <ul className="divide-y divide-border">
                                {redemptions.data.map((r) => (
                                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[15px]">
                                        <span className="font-medium text-text">{r.tenant.name}</span>
                                        <span className="text-muted">
                                            {formatDateTime(r.redeemedAt)}
                                            {r.effect?.to?.trialEndsAt ? ` · until ${formatDate(r.effect.to.trialEndsAt)}` : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
